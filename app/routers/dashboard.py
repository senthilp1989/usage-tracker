import hmac
from datetime import date, datetime, time, timedelta, timezone
from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import BigInteger, func, literal, select, union, union_all
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
    DocumentEventDetail,
    ExecutedEventDetail,
    LoginIn,
    LoginOut,
    Page,
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
    search: Optional[str] = None,
):
    # All filtering (date range, user, environment - and, on /artifacts,
    # interface) happens here as SQL WHERE clauses, never in Python after
    # the fact. `search` and `environment` are mutually exclusive - the
    # frontend never sends both (search overrides the environment dropdown).
    start, end = _range_bounds(date_from, date_to)
    query = query.filter(model.created_at >= start, model.created_at < end)
    if user_email:
        query = query.filter(model.user_email.in_(user_email))
    if search:
        query = query.filter(model.environment.ilike(f"%{search}%"))
    elif environment:
        query = query.filter(model.environment.in_(environment))
    return query


def _search_predicate(model, environment: Optional[List[str]], search: Optional[str]):
    """Same environment/search exclusivity as `_scoped`, as a raw predicate list for use in `select().where()`."""
    if search:
        return [model.environment.ilike(f"%{search}%")]
    if environment:
        return [model.environment.in_(environment)]
    return []


def _day(col):
    return func.date(col)


@router.get("/summary", response_model=StatsSummary, dependencies=[Depends(verify_dashboard_token)])
def summary(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
) -> StatsSummary:
    created_count = _scoped(
        db.query(func.count(TestCaseCreatedEvent.id)), TestCaseCreatedEvent, date_from, date_to, user_email, environment, search
    ).scalar() or 0

    executed_count = _scoped(
        db.query(func.count(TestCaseExecutedEvent.id)),
        TestCaseExecutedEvent, date_from, date_to, user_email, environment, search,
    ).scalar() or 0

    documents_count = _scoped(
        db.query(func.count(DocumentGeneratedEvent.id)),
        DocumentGeneratedEvent, date_from, date_to, user_email, environment, search,
    ).scalar() or 0

    test_case_documents_count = _scoped(
        db.query(func.count(TestCaseDocumentGeneratedEvent.id)),
        TestCaseDocumentGeneratedEvent, date_from, date_to, user_email, environment, search,
    ).scalar() or 0

    users_reporting = _distinct_user_count(db, date_from, date_to, user_email, environment, search)

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
    search: Optional[str] = None,
) -> int:
    start, end = _range_bounds(date_from, date_to)
    parts = []
    for model in (TestCaseCreatedEvent, TestCaseExecutedEvent, DocumentGeneratedEvent, TestCaseDocumentGeneratedEvent):
        part = select(model.user_email).where(model.created_at >= start, model.created_at < end)
        if user_email:
            part = part.where(model.user_email.in_(user_email))
        for predicate in _search_predicate(model, environment, search):
            part = part.where(predicate)
        parts.append(part)
    combined = union(*parts).subquery()
    return db.execute(select(func.count(func.distinct(combined.c.user_email)))).scalar() or 0


@router.get("/daily", response_model=List[DailyStats], dependencies=[Depends(verify_dashboard_token)])
def daily(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
) -> List[DailyStats]:
    created_rows = _scoped(
        db.query(_day(TestCaseCreatedEvent.created_at).label("day"), func.count(TestCaseCreatedEvent.id).label("count")),
        TestCaseCreatedEvent, date_from, date_to, user_email, environment, search,
    ).group_by("day").all()

    executed_rows = _scoped(
        db.query(
            _day(TestCaseExecutedEvent.created_at).label("day"),
            func.count(TestCaseExecutedEvent.id).label("count"),
        ),
        TestCaseExecutedEvent, date_from, date_to, user_email, environment, search,
    ).group_by("day").all()

    document_rows = _scoped(
        db.query(_day(DocumentGeneratedEvent.created_at).label("day"), func.count(DocumentGeneratedEvent.id).label("count")),
        DocumentGeneratedEvent, date_from, date_to, user_email, environment, search,
    ).group_by("day").all()

    test_case_document_rows = _scoped(
        db.query(
            _day(TestCaseDocumentGeneratedEvent.created_at).label("day"),
            func.count(TestCaseDocumentGeneratedEvent.id).label("count"),
        ),
        TestCaseDocumentGeneratedEvent, date_from, date_to, user_email, environment, search,
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


# --- /users and /artifacts: each combines 4 differently-shaped grouped
# queries (one per event table, no single source table to GROUP BY across).
# To make these paginable in SQL (rather than fetching the whole date-range
# aggregate into Python), each table contributes a UNION ALL branch with the
# same column shape - its own metric as a real COUNT, the other three
# metrics as a typed zero placeholder - and an outer query re-GROUPs the
# union by key, SUMs the metrics, and applies ORDER BY/OFFSET/LIMIT in
# Postgres. `total` comes from a COUNT(*) over just the distinct keys,
# never from fetching every row into Python.

_ZERO = lambda: literal(0, type_=BigInteger())  # noqa: E731


def _users_branch(
    model,
    metric: str,
    date_from: date,
    date_to: date,
    user_email: Optional[List[str]],
    environment: Optional[List[str]],
    search: Optional[str],
):
    start, end = _range_bounds(date_from, date_to)
    day = _day(model.created_at).label("report_date")
    metric_cols = {
        "test_cases_created": _ZERO(),
        "test_cases_executed": _ZERO(),
        "documents_generated": _ZERO(),
        "test_case_documents_generated": _ZERO(),
    }
    metric_cols[metric] = func.count(model.id)

    q = select(
        model.user_email.label("user_email"),
        model.environment.label("environment"),
        day,
        metric_cols["test_cases_created"].label("test_cases_created"),
        metric_cols["test_cases_executed"].label("test_cases_executed"),
        metric_cols["documents_generated"].label("documents_generated"),
        metric_cols["test_case_documents_generated"].label("test_case_documents_generated"),
        func.max(model.reported_at).label("last_event_at"),
    ).where(model.created_at >= start, model.created_at < end)
    if user_email:
        q = q.where(model.user_email.in_(user_email))
    for predicate in _search_predicate(model, environment, search):
        q = q.where(predicate)
    return q.group_by(model.user_email, model.environment, day)


@router.get("/users", response_model=Page[UserStats], dependencies=[Depends(verify_dashboard_token)])
def users(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=200),
    db: Session = Depends(get_db),
) -> Page[UserStats]:
    branches = [
        _users_branch(model, metric, date_from, date_to, user_email, environment, search)
        for model, metric in (
            (TestCaseCreatedEvent, "test_cases_created"),
            (TestCaseExecutedEvent, "test_cases_executed"),
            (DocumentGeneratedEvent, "documents_generated"),
            (TestCaseDocumentGeneratedEvent, "test_case_documents_generated"),
        )
    ]
    combined = union_all(*branches).subquery()

    key_subquery = (
        select(combined.c.user_email, combined.c.environment, combined.c.report_date)
        .group_by(combined.c.user_email, combined.c.environment, combined.c.report_date)
        .subquery()
    )
    total = db.execute(select(func.count()).select_from(key_subquery)).scalar() or 0

    page_rows = db.execute(
        select(
            combined.c.user_email,
            combined.c.environment,
            combined.c.report_date,
            func.sum(combined.c.test_cases_created).label("test_cases_created"),
            func.sum(combined.c.test_cases_executed).label("test_cases_executed"),
            func.sum(combined.c.documents_generated).label("documents_generated"),
            func.sum(combined.c.test_case_documents_generated).label("test_case_documents_generated"),
            func.max(combined.c.last_event_at).label("last_event_at"),
        )
        .group_by(combined.c.user_email, combined.c.environment, combined.c.report_date)
        .order_by(combined.c.user_email, combined.c.environment, combined.c.report_date)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    return Page(items=[UserStats(**row._mapping) for row in page_rows], total=total)


def _artifacts_branch(
    model,
    metric: str,
    date_from: date,
    date_to: date,
    user_email: Optional[List[str]],
    environment: Optional[List[str]],
    interface_name: Optional[List[str]],
    search: Optional[str],
):
    start, end = _range_bounds(date_from, date_to)
    metric_cols = {
        "test_cases_created": _ZERO(),
        "test_cases_executed": _ZERO(),
        "documents_generated": _ZERO(),
        "test_case_documents_generated": _ZERO(),
    }
    metric_cols[metric] = func.count(model.id)

    q = select(
        model.environment.label("environment"),
        model.interface_name.label("interface_name"),
        metric_cols["test_cases_created"].label("test_cases_created"),
        metric_cols["test_cases_executed"].label("test_cases_executed"),
        metric_cols["documents_generated"].label("documents_generated"),
        metric_cols["test_case_documents_generated"].label("test_case_documents_generated"),
    ).where(model.created_at >= start, model.created_at < end)
    if user_email:
        q = q.where(model.user_email.in_(user_email))
    for predicate in _search_predicate(model, environment, search):
        q = q.where(predicate)
    if interface_name:
        q = q.where(model.interface_name.in_(interface_name))
    return q.group_by(model.environment, model.interface_name)


@router.get("/artifacts", response_model=Page[ArtifactStats], dependencies=[Depends(verify_dashboard_token)])
def artifacts(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    interface_name: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=200),
    db: Session = Depends(get_db),
) -> Page[ArtifactStats]:
    branches = [
        _artifacts_branch(model, metric, date_from, date_to, user_email, environment, interface_name, search)
        for model, metric in (
            (TestCaseCreatedEvent, "test_cases_created"),
            (TestCaseExecutedEvent, "test_cases_executed"),
            (DocumentGeneratedEvent, "documents_generated"),
            (TestCaseDocumentGeneratedEvent, "test_case_documents_generated"),
        )
    ]
    combined = union_all(*branches).subquery()

    key_subquery = (
        select(combined.c.environment, combined.c.interface_name)
        .group_by(combined.c.environment, combined.c.interface_name)
        .subquery()
    )
    total = db.execute(select(func.count()).select_from(key_subquery)).scalar() or 0

    page_rows = db.execute(
        select(
            combined.c.environment,
            combined.c.interface_name,
            func.sum(combined.c.test_cases_created).label("test_cases_created"),
            func.sum(combined.c.test_cases_executed).label("test_cases_executed"),
            func.sum(combined.c.documents_generated).label("documents_generated"),
            func.sum(combined.c.test_case_documents_generated).label("test_case_documents_generated"),
        )
        .group_by(combined.c.environment, combined.c.interface_name)
        .order_by(combined.c.environment, combined.c.interface_name)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    return Page(items=[ArtifactStats(**row._mapping) for row in page_rows], total=total)


def _paginate_events(
    db: Session,
    model,
    columns,
    schema,
    date_from: date,
    date_to: date,
    user_email: Optional[List[str]],
    environment: Optional[List[str]],
    search: Optional[str],
    page: int,
    page_size: int,
):
    total = _scoped(
        db.query(func.count(model.id)), model, date_from, date_to, user_email, environment, search
    ).scalar() or 0
    rows = (
        _scoped(db.query(*columns), model, date_from, date_to, user_email, environment, search)
        .order_by(model.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return Page(items=[schema(**r._mapping) for r in rows], total=total)


@router.get("/created-events", response_model=Page[CreatedEventDetail], dependencies=[Depends(verify_dashboard_token)])
def created_events(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=200),
    db: Session = Depends(get_db),
) -> Page[CreatedEventDetail]:
    return _paginate_events(
        db,
        TestCaseCreatedEvent,
        (
            TestCaseCreatedEvent.user_email,
            TestCaseCreatedEvent.environment,
            TestCaseCreatedEvent.interface_name,
            TestCaseCreatedEvent.test_case_name,
            TestCaseCreatedEvent.created_at,
        ),
        CreatedEventDetail,
        date_from, date_to, user_email, environment, search, page, page_size,
    )


@router.get(
    "/executed-events", response_model=Page[ExecutedEventDetail], dependencies=[Depends(verify_dashboard_token)]
)
def executed_events(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=200),
    db: Session = Depends(get_db),
) -> Page[ExecutedEventDetail]:
    return _paginate_events(
        db,
        TestCaseExecutedEvent,
        (
            TestCaseExecutedEvent.user_email,
            TestCaseExecutedEvent.environment,
            TestCaseExecutedEvent.interface_name,
            TestCaseExecutedEvent.test_case_name,
            TestCaseExecutedEvent.created_at,
        ),
        ExecutedEventDetail,
        date_from, date_to, user_email, environment, search, page, page_size,
    )


@router.get(
    "/document-events", response_model=Page[DocumentEventDetail], dependencies=[Depends(verify_dashboard_token)]
)
def document_events(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=200),
    db: Session = Depends(get_db),
) -> Page[DocumentEventDetail]:
    return _paginate_events(
        db,
        DocumentGeneratedEvent,
        (
            DocumentGeneratedEvent.user_email,
            DocumentGeneratedEvent.environment,
            DocumentGeneratedEvent.interface_name,
            DocumentGeneratedEvent.created_at,
        ),
        DocumentEventDetail,
        date_from, date_to, user_email, environment, search, page, page_size,
    )


@router.get(
    "/test-case-document-events",
    response_model=Page[TestCaseDocumentEventDetail],
    dependencies=[Depends(verify_dashboard_token)],
)
def test_case_document_events(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=200),
    db: Session = Depends(get_db),
) -> Page[TestCaseDocumentEventDetail]:
    return _paginate_events(
        db,
        TestCaseDocumentGeneratedEvent,
        (
            TestCaseDocumentGeneratedEvent.user_email,
            TestCaseDocumentGeneratedEvent.environment,
            TestCaseDocumentGeneratedEvent.interface_name,
            TestCaseDocumentGeneratedEvent.suite_name,
            TestCaseDocumentGeneratedEvent.test_case_names,
            TestCaseDocumentGeneratedEvent.test_case_count,
            TestCaseDocumentGeneratedEvent.created_at,
        ),
        TestCaseDocumentEventDetail,
        date_from, date_to, user_email, environment, search, page, page_size,
    )


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
