import hmac
from datetime import date, datetime, time, timedelta, timezone
from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, union
from sqlalchemy.orm import Session

from ..auth import create_dashboard_token, verify_dashboard_token
from ..config import settings
from ..database import get_db
from ..models import (
    DocumentGeneratedEvent,
    TestCaseCreatedEvent,
    TestCaseDocumentGeneratedEvent,
    TestCaseExecutedEvent,
)
from ..schemas import (
    ArtifactStats,
    CreatedEventDetail,
    DailyStats,
    ExecutedEventDetail,
    LoginIn,
    LoginOut,
    StatsSummary,
    TestCaseDocumentEventDetail,
    UserStats,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.post("/login", response_model=LoginOut)
def login(payload: LoginIn) -> LoginOut:
    user_ok = hmac.compare_digest(payload.username, settings.dashboard_username)
    pass_ok = hmac.compare_digest(payload.password, settings.dashboard_password)
    if not (user_ok and pass_ok):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token, expires = create_dashboard_token()
    return LoginOut(token=token, expires_at=datetime.fromtimestamp(expires, tz=timezone.utc))


def _range_bounds(date_from: date, date_to: date) -> Tuple[datetime, datetime]:
    # Half-open [start, end) timestamp range from two IST calendar dates -
    # matched directly against created_at with no function wrapping the
    # column, so the plain index on created_at stays usable as row counts
    # grow. created_at is already naive IST wall-clock (see models.py), so
    # these bounds line up with it with no timezone conversion needed.
    start = datetime.combine(date_from, time.min)
    end = datetime.combine(date_to + timedelta(days=1), time.min)
    return start, end


def _scoped(
    query,
    model,
    date_from: date,
    date_to: date,
    user_email: Optional[List[str]],
    environment: Optional[List[str]] = None,
):
    # All filtering (date range, user, environment - and, on /artifacts,
    # interface) happens here as SQL WHERE clauses, never in Python after
    # the fact.
    start, end = _range_bounds(date_from, date_to)
    query = query.filter(model.created_at >= start, model.created_at < end)
    if user_email:
        query = query.filter(model.user_email.in_(user_email))
    if environment:
        query = query.filter(model.environment.in_(environment))
    return query


def _day(col):
    return func.date(col)


@router.get("/summary", response_model=StatsSummary, dependencies=[Depends(verify_dashboard_token)])
def summary(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    db: Session = Depends(get_db),
) -> StatsSummary:
    created_count = _scoped(
        db.query(func.count(TestCaseCreatedEvent.id)), TestCaseCreatedEvent, date_from, date_to, user_email, environment
    ).scalar() or 0

    executed_count = _scoped(
        db.query(func.count(TestCaseExecutedEvent.id)),
        TestCaseExecutedEvent, date_from, date_to, user_email, environment,
    ).scalar() or 0

    documents_count = _scoped(
        db.query(func.count(DocumentGeneratedEvent.id)),
        DocumentGeneratedEvent, date_from, date_to, user_email, environment,
    ).scalar() or 0

    test_case_documents_count = _scoped(
        db.query(func.count(TestCaseDocumentGeneratedEvent.id)),
        TestCaseDocumentGeneratedEvent, date_from, date_to, user_email, environment,
    ).scalar() or 0

    users_reporting = _distinct_user_count(db, date_from, date_to, user_email, environment)

    return StatsSummary(
        users_reporting=users_reporting,
        test_cases_created=created_count,
        test_cases_executed=executed_count,
        documents_generated=documents_count,
        test_case_documents_generated=test_case_documents_count,
    )


def _distinct_user_count(
    db: Session,
    date_from: date,
    date_to: date,
    user_email: Optional[List[str]],
    environment: Optional[List[str]],
) -> int:
    start, end = _range_bounds(date_from, date_to)
    parts = []
    for model in (TestCaseCreatedEvent, TestCaseExecutedEvent, DocumentGeneratedEvent, TestCaseDocumentGeneratedEvent):
        part = select(model.user_email).where(model.created_at >= start, model.created_at < end)
        if user_email:
            part = part.where(model.user_email.in_(user_email))
        if environment:
            part = part.where(model.environment.in_(environment))
        parts.append(part)
    combined = union(*parts).subquery()
    return db.execute(select(func.count(func.distinct(combined.c.user_email)))).scalar() or 0


@router.get("/daily", response_model=List[DailyStats], dependencies=[Depends(verify_dashboard_token)])
def daily(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    db: Session = Depends(get_db),
) -> List[DailyStats]:
    created_rows = _scoped(
        db.query(_day(TestCaseCreatedEvent.created_at).label("day"), func.count(TestCaseCreatedEvent.id).label("count")),
        TestCaseCreatedEvent, date_from, date_to, user_email, environment,
    ).group_by("day").all()

    executed_rows = _scoped(
        db.query(
            _day(TestCaseExecutedEvent.created_at).label("day"),
            func.count(TestCaseExecutedEvent.id).label("count"),
        ),
        TestCaseExecutedEvent, date_from, date_to, user_email, environment,
    ).group_by("day").all()

    document_rows = _scoped(
        db.query(_day(DocumentGeneratedEvent.created_at).label("day"), func.count(DocumentGeneratedEvent.id).label("count")),
        DocumentGeneratedEvent, date_from, date_to, user_email, environment,
    ).group_by("day").all()

    test_case_document_rows = _scoped(
        db.query(
            _day(TestCaseDocumentGeneratedEvent.created_at).label("day"),
            func.count(TestCaseDocumentGeneratedEvent.id).label("count"),
        ),
        TestCaseDocumentGeneratedEvent, date_from, date_to, user_email, environment,
    ).group_by("day").all()

    # Four already-filtered, already-aggregated result sets get combined
    # into one row per day here - this is a join/reshape across sources
    # (there's no single raw-event table to group by day directly), not a
    # filtering step; every WHERE-clause condition already ran in Postgres
    # above.
    by_day: dict = {}

    def _entry(day):
        return by_day.setdefault(
            day,
            {
                "test_cases_created": 0,
                "test_cases_executed": 0,
                "documents_generated": 0,
                "test_case_documents_generated": 0,
            },
        )

    for r in created_rows:
        _entry(r.day)["test_cases_created"] = r.count
    for r in executed_rows:
        _entry(r.day)["test_cases_executed"] = r.count
    for r in document_rows:
        _entry(r.day)["documents_generated"] = r.count
    for r in test_case_document_rows:
        _entry(r.day)["test_case_documents_generated"] = r.count

    return [DailyStats(day=day, **values) for day, values in sorted(by_day.items())]


@router.get("/users", response_model=List[UserStats], dependencies=[Depends(verify_dashboard_token)])
def users(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    db: Session = Depends(get_db),
) -> List[UserStats]:
    created_rows = _scoped(
        db.query(
            TestCaseCreatedEvent.user_email,
            TestCaseCreatedEvent.environment,
            _day(TestCaseCreatedEvent.created_at).label("report_date"),
            func.count(TestCaseCreatedEvent.id).label("count"),
            func.max(TestCaseCreatedEvent.reported_at).label("last_event_at"),
        ),
        TestCaseCreatedEvent, date_from, date_to, user_email, environment,
    ).group_by(TestCaseCreatedEvent.user_email, TestCaseCreatedEvent.environment, "report_date").all()

    executed_rows = _scoped(
        db.query(
            TestCaseExecutedEvent.user_email,
            TestCaseExecutedEvent.environment,
            _day(TestCaseExecutedEvent.created_at).label("report_date"),
            func.count(TestCaseExecutedEvent.id).label("executed"),
            func.max(TestCaseExecutedEvent.reported_at).label("last_event_at"),
        ),
        TestCaseExecutedEvent, date_from, date_to, user_email, environment,
    ).group_by(TestCaseExecutedEvent.user_email, TestCaseExecutedEvent.environment, "report_date").all()

    document_rows = _scoped(
        db.query(
            DocumentGeneratedEvent.user_email,
            DocumentGeneratedEvent.environment,
            _day(DocumentGeneratedEvent.created_at).label("report_date"),
            func.count(DocumentGeneratedEvent.id).label("count"),
            func.max(DocumentGeneratedEvent.reported_at).label("last_event_at"),
        ),
        DocumentGeneratedEvent, date_from, date_to, user_email, environment,
    ).group_by(DocumentGeneratedEvent.user_email, DocumentGeneratedEvent.environment, "report_date").all()

    test_case_document_rows = _scoped(
        db.query(
            TestCaseDocumentGeneratedEvent.user_email,
            TestCaseDocumentGeneratedEvent.environment,
            _day(TestCaseDocumentGeneratedEvent.created_at).label("report_date"),
            func.count(TestCaseDocumentGeneratedEvent.id).label("count"),
            func.max(TestCaseDocumentGeneratedEvent.reported_at).label("last_event_at"),
        ),
        TestCaseDocumentGeneratedEvent, date_from, date_to, user_email, environment,
    ).group_by(TestCaseDocumentGeneratedEvent.user_email, TestCaseDocumentGeneratedEvent.environment, "report_date").all()

    by_key: dict = {}

    def _entry(u, e, d):
        return by_key.setdefault(
            (u, e, d),
            {
                "user_email": u,
                "environment": e,
                "report_date": d,
                "test_cases_created": 0,
                "test_cases_executed": 0,
                "documents_generated": 0,
                "test_case_documents_generated": 0,
                "last_event_at": None,
            },
        )

    def _bump_last(entry, candidate):
        if candidate and (entry["last_event_at"] is None or candidate > entry["last_event_at"]):
            entry["last_event_at"] = candidate

    for r in created_rows:
        entry = _entry(r.user_email, r.environment, r.report_date)
        entry["test_cases_created"] = r.count
        _bump_last(entry, r.last_event_at)
    for r in executed_rows:
        entry = _entry(r.user_email, r.environment, r.report_date)
        entry["test_cases_executed"] = r.executed
        _bump_last(entry, r.last_event_at)
    for r in document_rows:
        entry = _entry(r.user_email, r.environment, r.report_date)
        entry["documents_generated"] = r.count
        _bump_last(entry, r.last_event_at)
    for r in test_case_document_rows:
        entry = _entry(r.user_email, r.environment, r.report_date)
        entry["test_case_documents_generated"] = r.count
        _bump_last(entry, r.last_event_at)

    return [
        UserStats(**values)
        for values in sorted(by_key.values(), key=lambda v: (v["user_email"], v["environment"], v["report_date"]))
    ]


@router.get("/artifacts", response_model=List[ArtifactStats], dependencies=[Depends(verify_dashboard_token)])
def artifacts(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    interface_name: Optional[List[str]] = Query(default=None),
    db: Session = Depends(get_db),
) -> List[ArtifactStats]:
    def _artifact_scoped(query, model):
        query = _scoped(query, model, date_from, date_to, user_email, environment)
        if interface_name:
            query = query.filter(model.interface_name.in_(interface_name))
        return query

    created_rows = _artifact_scoped(
        db.query(
            TestCaseCreatedEvent.environment,
            TestCaseCreatedEvent.interface_name,
            func.count(TestCaseCreatedEvent.id).label("count"),
        ),
        TestCaseCreatedEvent,
    ).group_by(TestCaseCreatedEvent.environment, TestCaseCreatedEvent.interface_name).all()

    executed_rows = _artifact_scoped(
        db.query(
            TestCaseExecutedEvent.environment,
            TestCaseExecutedEvent.interface_name,
            func.count(TestCaseExecutedEvent.id).label("count"),
        ),
        TestCaseExecutedEvent,
    ).group_by(TestCaseExecutedEvent.environment, TestCaseExecutedEvent.interface_name).all()

    document_rows = _artifact_scoped(
        db.query(
            DocumentGeneratedEvent.environment,
            DocumentGeneratedEvent.interface_name,
            func.count(DocumentGeneratedEvent.id).label("count"),
        ),
        DocumentGeneratedEvent,
    ).group_by(DocumentGeneratedEvent.environment, DocumentGeneratedEvent.interface_name).all()

    test_case_document_rows = _artifact_scoped(
        db.query(
            TestCaseDocumentGeneratedEvent.environment,
            TestCaseDocumentGeneratedEvent.interface_name,
            func.count(TestCaseDocumentGeneratedEvent.id).label("count"),
        ),
        TestCaseDocumentGeneratedEvent,
    ).group_by(TestCaseDocumentGeneratedEvent.environment, TestCaseDocumentGeneratedEvent.interface_name).all()

    by_key: dict = {}

    def _entry(env, iface):
        return by_key.setdefault(
            (env, iface),
            {
                "environment": env,
                "interface_name": iface,
                "test_cases_created": 0,
                "test_cases_executed": 0,
                "documents_generated": 0,
                "test_case_documents_generated": 0,
            },
        )

    for r in created_rows:
        _entry(r.environment, r.interface_name)["test_cases_created"] = r.count
    for r in executed_rows:
        _entry(r.environment, r.interface_name)["test_cases_executed"] = r.count
    for r in document_rows:
        _entry(r.environment, r.interface_name)["documents_generated"] = r.count
    for r in test_case_document_rows:
        _entry(r.environment, r.interface_name)["test_case_documents_generated"] = r.count

    return [
        ArtifactStats(**values)
        for values in sorted(by_key.values(), key=lambda v: (v["environment"], v["interface_name"]))
    ]


@router.get("/created-events", response_model=List[CreatedEventDetail], dependencies=[Depends(verify_dashboard_token)])
def created_events(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    db: Session = Depends(get_db),
) -> List[CreatedEventDetail]:
    rows = (
        _scoped(
            db.query(
                TestCaseCreatedEvent.user_email,
                TestCaseCreatedEvent.environment,
                TestCaseCreatedEvent.interface_name,
                TestCaseCreatedEvent.test_case_name,
                TestCaseCreatedEvent.created_at,
            ),
            TestCaseCreatedEvent, date_from, date_to, user_email, environment,
        )
        .order_by(TestCaseCreatedEvent.created_at.desc())
        .all()
    )
    return [CreatedEventDetail(**r._mapping) for r in rows]


@router.get(
    "/executed-events", response_model=List[ExecutedEventDetail], dependencies=[Depends(verify_dashboard_token)]
)
def executed_events(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    db: Session = Depends(get_db),
) -> List[ExecutedEventDetail]:
    rows = (
        _scoped(
            db.query(
                TestCaseExecutedEvent.user_email,
                TestCaseExecutedEvent.environment,
                TestCaseExecutedEvent.interface_name,
                TestCaseExecutedEvent.test_case_name,
                TestCaseExecutedEvent.created_at,
            ),
            TestCaseExecutedEvent, date_from, date_to, user_email, environment,
        )
        .order_by(TestCaseExecutedEvent.created_at.desc())
        .all()
    )
    return [ExecutedEventDetail(**r._mapping) for r in rows]


@router.get(
    "/test-case-document-events",
    response_model=List[TestCaseDocumentEventDetail],
    dependencies=[Depends(verify_dashboard_token)],
)
def test_case_document_events(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    db: Session = Depends(get_db),
) -> List[TestCaseDocumentEventDetail]:
    rows = (
        _scoped(
            db.query(
                TestCaseDocumentGeneratedEvent.user_email,
                TestCaseDocumentGeneratedEvent.environment,
                TestCaseDocumentGeneratedEvent.interface_name,
                TestCaseDocumentGeneratedEvent.suite_name,
                TestCaseDocumentGeneratedEvent.test_case_names,
                TestCaseDocumentGeneratedEvent.test_case_count,
                TestCaseDocumentGeneratedEvent.created_at,
            ),
            TestCaseDocumentGeneratedEvent, date_from, date_to, user_email, environment,
        )
        .order_by(TestCaseDocumentGeneratedEvent.created_at.desc())
        .all()
    )
    return [TestCaseDocumentEventDetail(**r._mapping) for r in rows]


@router.get("/user-emails", response_model=List[str], dependencies=[Depends(verify_dashboard_token)])
def user_emails(db: Session = Depends(get_db)) -> List[str]:
    combined = union(
        select(TestCaseCreatedEvent.user_email),
        select(TestCaseExecutedEvent.user_email),
        select(DocumentGeneratedEvent.user_email),
        select(TestCaseDocumentGeneratedEvent.user_email),
    ).subquery()
    rows = db.execute(select(combined.c.user_email).distinct().order_by(combined.c.user_email)).all()
    return [r[0] for r in rows]


@router.get("/environments", response_model=List[str], dependencies=[Depends(verify_dashboard_token)])
def environments(db: Session = Depends(get_db)) -> List[str]:
    combined = union(
        select(TestCaseCreatedEvent.environment),
        select(TestCaseExecutedEvent.environment),
        select(DocumentGeneratedEvent.environment),
        select(TestCaseDocumentGeneratedEvent.environment),
    ).subquery()
    rows = db.execute(select(combined.c.environment).distinct().order_by(combined.c.environment)).all()
    return [r[0] for r in rows]


@router.get("/interfaces", response_model=List[str], dependencies=[Depends(verify_dashboard_token)])
def interfaces(db: Session = Depends(get_db)) -> List[str]:
    combined = union(
        select(TestCaseCreatedEvent.interface_name),
        select(TestCaseExecutedEvent.interface_name),
    ).subquery()
    rows = db.execute(select(combined.c.interface_name).distinct().order_by(combined.c.interface_name)).all()
    return [r[0] for r in rows]
