import csv
import hmac
import io
from datetime import date, datetime, time, timedelta, timezone
from typing import Callable, List, Optional, Sequence, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import (
    BigInteger,
    String,
    cast,
    func,
    literal,
    nulls_last,
    or_,
    select,
    text,
    union,
    union_all,
)
from sqlalchemy.dialects.postgresql import JSONB
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
    EnvironmentRollupStats,
    ExecutedEventDetail,
    LoginIn,
    LoginOut,
    Page,
    StatsSummary,
    TestCaseDocumentEventDetail,
    UserEnvironmentStats,
    UserRollupStats,
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
    active_days, environments_active = _activity_span(db, date_from, date_to, user_email, environment, search)

    return StatsSummary(
        users_reporting=users_reporting,
        test_cases_created=created_count,
        test_cases_executed=executed_count,
        documents_generated=documents_count,
        test_case_documents_generated=test_case_documents_count,
        active_days=active_days,
        environments_active=environments_active,
    )


def _activity_span(
    db: Session,
    date_from: date,
    date_to: date,
    user_email: Optional[List[str]],
    environment: Optional[List[str]],
    search: Optional[str] = None,
) -> Tuple[int, int]:
    """Distinct active days and distinct environments in scope, from the same
    combined (user, environment, day) subquery the /users endpoints use - the
    frontend used to derive both from the flat /users/export rows."""
    _, combined = _users_grouped_query(date_from, date_to, user_email, environment, search)
    row = db.execute(
        select(
            func.count(func.distinct(combined.c.report_date)),
            func.count(func.distinct(combined.c.environment)),
        )
    ).one()
    return row[0] or 0, row[1] or 0


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


def _users_grouped_query(
    date_from: date,
    date_to: date,
    user_email: Optional[List[str]],
    environment: Optional[List[str]],
    search: Optional[str],
):
    """Grouped + ordered (user, environment, day) query, shared by /users (paginated) and
    /users/export (everything, no offset/limit). Returns (select statement, combined subquery)
    - the caller adds offset/limit or a count query against the subquery as needed."""
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
    query = (
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
    )
    return query, combined


# Free-text `q` on /users matches the flat table's two text columns; sorting
# is by any output column name (whitelist below - validated before it reaches
# the text() ORDER BY, which Postgres resolves against the labeled columns).

_USERS_SORT_COLUMNS = (
    "user_email",
    "environment",
    "report_date",
    "test_cases_created",
    "test_cases_executed",
    "documents_generated",
    "test_case_documents_generated",
    "last_event_at",
)


def _users_q_predicates(combined, q: Optional[str]):
    if not q:
        return []
    like = f"%{q}%"
    return [or_(combined.c.user_email.ilike(like), combined.c.environment.ilike(like))]


def _users_order(query, sort_by: Optional[str], sort_dir: str):
    if sort_by is None:
        return query
    if sort_by not in _USERS_SORT_COLUMNS:
        raise HTTPException(status_code=400, detail=f"Cannot sort by {sort_by!r}")
    direction = "DESC" if sort_dir == "desc" else "ASC"
    return query.order_by(None).order_by(
        text(f"{sort_by} {direction} NULLS LAST"),
        text("user_email ASC, environment ASC, report_date ASC"),
    )


@router.get("/users", response_model=Page[UserStats], dependencies=[Depends(verify_dashboard_token)])
def users(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=200),
    q: Optional[str] = Query(default=None),
    sort_by: Optional[str] = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
) -> Page[UserStats]:
    query, combined = _users_grouped_query(date_from, date_to, user_email, environment, search)
    predicates = _users_q_predicates(combined, q)
    for predicate in predicates:
        query = query.where(predicate)
    query = _users_order(query, sort_by, sort_dir)

    key_source = select(combined.c.user_email, combined.c.environment, combined.c.report_date)
    for predicate in predicates:
        key_source = key_source.where(predicate)
    key_subquery = key_source.group_by(
        combined.c.user_email, combined.c.environment, combined.c.report_date
    ).subquery()
    total = db.execute(select(func.count()).select_from(key_subquery)).scalar() or 0

    page_rows = db.execute(query.offset((page - 1) * page_size).limit(page_size)).all()

    return Page(items=[UserStats(**row._mapping) for row in page_rows], total=total)


@router.get("/users/export", response_model=List[UserStats], dependencies=[Depends(verify_dashboard_token)])
def users_export(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    sort_by: Optional[str] = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    format: str = Query(default="json", pattern="^(json|csv)$"),
    db: Session = Depends(get_db),
):
    query, combined = _users_grouped_query(date_from, date_to, user_email, environment, search)
    for predicate in _users_q_predicates(combined, q):
        query = query.where(predicate)
    query = _users_order(query, sort_by, sort_dir)
    rows = db.execute(query).all()
    items = [UserStats(**row._mapping) for row in rows]
    return _maybe_csv(
        items, format, f"testease-usage-{date_from}-to-{date_to}.csv",
        [
            "User", "Environment", "Date",
            "Test cases created", "Test cases executed",
            "TSD documents generated", "Test case documents generated",
        ],
        lambda r: [
            r.user_email,
            r.environment,
            r.report_date.isoformat(),
            r.test_cases_created,
            r.test_cases_executed,
            r.documents_generated,
            r.test_case_documents_generated,
        ],
    )


# --- /rollup twins: the server-side versions of the grouping the frontend
# used to do in JS over the flat /users/export rows. Both are a second GROUP
# BY over the exact same combined (user, environment, day) subquery /users
# and /users/export are built on - identical filtering by construction, so a
# rollup can never disagree with the flat fact table it summarizes.

_METRIC_COLUMNS = (
    "test_cases_created",
    "test_cases_executed",
    "documents_generated",
    "test_case_documents_generated",
)


def _rollup_rows(
    db: Session,
    date_from: date,
    date_to: date,
    user_email: Optional[List[str]],
    environment: Optional[List[str]],
    search: Optional[str],
    key: str,
    other: str,
    other_label: str,
):
    """One row per `key`, summing the four metrics and counting distinct days
    and distinct `other` values - the same numbers the frontend's old
    groupUsage() derived with Sets."""
    _, combined = _users_grouped_query(date_from, date_to, user_email, environment, search)
    key_col = getattr(combined.c, key)
    q = (
        select(
            key_col.label(key),
            *[func.sum(getattr(combined.c, m)).label(m) for m in _METRIC_COLUMNS],
            func.count(func.distinct(combined.c.report_date)).label("active_days"),
            func.count(func.distinct(getattr(combined.c, other))).label(other_label),
        )
        .group_by(key_col)
        .order_by(key_col)
    )
    return db.execute(q).all()


@router.get("/rollup/users", response_model=List[UserRollupStats], dependencies=[Depends(verify_dashboard_token)])
def users_rollup(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
) -> List[UserRollupStats]:
    rows = _rollup_rows(
        db, date_from, date_to, user_email, environment, search, "user_email", "environment", "environments"
    )
    return [UserRollupStats(**row._mapping) for row in rows]


@router.get(
    "/rollup/environments",
    response_model=List[EnvironmentRollupStats],
    dependencies=[Depends(verify_dashboard_token)],
)
def environments_rollup(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
) -> List[EnvironmentRollupStats]:
    rows = _rollup_rows(
        db, date_from, date_to, user_email, environment, search, "environment", "user_email", "users"
    )
    return [EnvironmentRollupStats(**row._mapping) for row in rows]


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


def _artifacts_grouped_query(
    date_from: date,
    date_to: date,
    user_email: Optional[List[str]],
    environment: Optional[List[str]],
    interface_name: Optional[List[str]],
    search: Optional[str],
):
    """Same shared-query pattern as `_users_grouped_query`, grouped by (environment, interface)."""
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
    query = (
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
    )
    return query, combined


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
    query, combined = _artifacts_grouped_query(date_from, date_to, user_email, environment, interface_name, search)

    key_subquery = (
        select(combined.c.environment, combined.c.interface_name)
        .group_by(combined.c.environment, combined.c.interface_name)
        .subquery()
    )
    total = db.execute(select(func.count()).select_from(key_subquery)).scalar() or 0

    page_rows = db.execute(query.offset((page - 1) * page_size).limit(page_size)).all()

    return Page(items=[ArtifactStats(**row._mapping) for row in page_rows], total=total)


@router.get("/artifacts/export", response_model=List[ArtifactStats], dependencies=[Depends(verify_dashboard_token)])
def artifacts_export(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    interface_name: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
) -> List[ArtifactStats]:
    query, _ = _artifacts_grouped_query(date_from, date_to, user_email, environment, interface_name, search)
    rows = db.execute(query).all()
    return [ArtifactStats(**row._mapping) for row in rows]


# --- Drawer-tab support: free-text `q` is ORed across the tab's text columns
# and ANDed on top of the date/user/environment scope (never instead of it);
# `sort_by` is validated against the tab's own columns; `format=csv` on the
# /export twins streams the full filtered-and-sorted set so the CSV button
# keeps meaning "everything the table shows" now that the table itself only
# fetches one page at a time.


def _q_predicates(q: Optional[str], search_cols):
    if not q:
        return []
    like = f"%{q}%"
    return [or_(*[col.ilike(like) for col in search_cols])]


def _event_order(model, columns, sort_by: Optional[str], sort_dir: str):
    if sort_by is None:
        return (model.created_at.desc(),)
    # JSONB columns (test_case_names) are excluded: sorting a JSON list has no
    # meaningful order, and the frontend greys that header out to match.
    sortable = {col.key: col for col in columns if not isinstance(col.type, JSONB)}
    if sort_by not in sortable:
        raise HTTPException(status_code=400, detail=f"Cannot sort by {sort_by!r}")
    col = sortable[sort_by]
    order = col.desc() if sort_dir == "desc" else col.asc()
    # created_at tiebreak keeps page boundaries stable when the sort key repeats.
    return (nulls_last(order), model.created_at.desc())


def _csv_response(filename: str, header: List[str], rows) -> StreamingResponse:
    def generate():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(header)
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
        for row in rows:
            writer.writerow(row)
            yield buf.getvalue()
            buf.seek(0)
            buf.truncate(0)

    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _maybe_csv(items, format: str, filename: str, header: List[str], row_fn: Callable):
    """Return `items` as-is for JSON, or stream them as a CSV attachment."""
    if format != "csv":
        return items
    return _csv_response(filename, header, (row_fn(r) for r in items))


def _csv_time(value: datetime) -> str:
    return value.replace(microsecond=0).isoformat(sep=" ")


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
    q: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: str = "desc",
    search_cols=(),
):
    predicates = _q_predicates(q, search_cols)
    total_query = _scoped(
        db.query(func.count(model.id)), model, date_from, date_to, user_email, environment, search
    )
    for predicate in predicates:
        total_query = total_query.filter(predicate)
    total = total_query.scalar() or 0

    rows_query = _scoped(db.query(*columns), model, date_from, date_to, user_email, environment, search)
    for predicate in predicates:
        rows_query = rows_query.filter(predicate)
    rows = (
        rows_query.order_by(*_event_order(model, columns, sort_by, sort_dir))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return Page(items=[schema(**r._mapping) for r in rows], total=total)


def _export_events(
    db: Session,
    model,
    columns,
    schema,
    date_from: date,
    date_to: date,
    user_email: Optional[List[str]],
    environment: Optional[List[str]],
    search: Optional[str],
    q: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: str = "desc",
    search_cols=(),
):
    rows_query = _scoped(db.query(*columns), model, date_from, date_to, user_email, environment, search)
    for predicate in _q_predicates(q, search_cols):
        rows_query = rows_query.filter(predicate)
    rows = rows_query.order_by(*_event_order(model, columns, sort_by, sort_dir)).all()
    return [schema(**r._mapping) for r in rows]


# Text columns each tab's free-text `q` matches against. tc-doc includes the
# JSONB name list via a text cast so "which document mentioned this test case"
# keeps working like the old client-side any-cell filter.

_CREATED_SEARCH = (
    TestCaseCreatedEvent.user_email,
    TestCaseCreatedEvent.environment,
    TestCaseCreatedEvent.interface_name,
    TestCaseCreatedEvent.test_case_name,
)
_EXECUTED_SEARCH = (
    TestCaseExecutedEvent.user_email,
    TestCaseExecutedEvent.environment,
    TestCaseExecutedEvent.interface_name,
    TestCaseExecutedEvent.test_case_name,
)
_DOCUMENT_SEARCH = (
    DocumentGeneratedEvent.user_email,
    DocumentGeneratedEvent.environment,
    DocumentGeneratedEvent.interface_name,
)
_TC_DOC_SEARCH = (
    TestCaseDocumentGeneratedEvent.user_email,
    TestCaseDocumentGeneratedEvent.environment,
    TestCaseDocumentGeneratedEvent.interface_name,
    TestCaseDocumentGeneratedEvent.suite_name,
    cast(TestCaseDocumentGeneratedEvent.test_case_names, String),
)


@router.get("/created-events", response_model=Page[CreatedEventDetail], dependencies=[Depends(verify_dashboard_token)])
def created_events(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=200),
    q: Optional[str] = Query(default=None),
    sort_by: Optional[str] = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
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
        q, sort_by, sort_dir, _CREATED_SEARCH,
    )


@router.get(
    "/created-events/export", response_model=List[CreatedEventDetail], dependencies=[Depends(verify_dashboard_token)]
)
def created_events_export(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    sort_by: Optional[str] = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    format: str = Query(default="json", pattern="^(json|csv)$"),
    db: Session = Depends(get_db),
):
    items = _export_events(
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
        date_from, date_to, user_email, environment, search,
        q, sort_by, sort_dir, _CREATED_SEARCH,
    )
    return _maybe_csv(
        items, format, "testease-created.csv",
        ["User", "Environment", "Interface", "Test case", "Created at"],
        lambda r: [r.user_email, r.environment, r.interface_name, r.test_case_name, _csv_time(r.created_at)],
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
    q: Optional[str] = Query(default=None),
    sort_by: Optional[str] = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
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
        q, sort_by, sort_dir, _EXECUTED_SEARCH,
    )


@router.get(
    "/executed-events/export", response_model=List[ExecutedEventDetail], dependencies=[Depends(verify_dashboard_token)]
)
def executed_events_export(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    sort_by: Optional[str] = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    format: str = Query(default="json", pattern="^(json|csv)$"),
    db: Session = Depends(get_db),
):
    items = _export_events(
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
        date_from, date_to, user_email, environment, search,
        q, sort_by, sort_dir, _EXECUTED_SEARCH,
    )
    return _maybe_csv(
        items, format, "testease-executed.csv",
        ["User", "Environment", "Interface", "Test case", "Executed at"],
        lambda r: [r.user_email, r.environment, r.interface_name, r.test_case_name, _csv_time(r.created_at)],
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
    q: Optional[str] = Query(default=None),
    sort_by: Optional[str] = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
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
        q, sort_by, sort_dir, _DOCUMENT_SEARCH,
    )


@router.get(
    "/document-events/export", response_model=List[DocumentEventDetail], dependencies=[Depends(verify_dashboard_token)]
)
def document_events_export(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    sort_by: Optional[str] = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    format: str = Query(default="json", pattern="^(json|csv)$"),
    db: Session = Depends(get_db),
):
    items = _export_events(
        db,
        DocumentGeneratedEvent,
        (
            DocumentGeneratedEvent.user_email,
            DocumentGeneratedEvent.environment,
            DocumentGeneratedEvent.interface_name,
            DocumentGeneratedEvent.created_at,
        ),
        DocumentEventDetail,
        date_from, date_to, user_email, environment, search,
        q, sort_by, sort_dir, _DOCUMENT_SEARCH,
    )
    return _maybe_csv(
        items, format, "testease-documents.csv",
        ["User", "Environment", "Interface", "Generated at"],
        lambda r: [r.user_email, r.environment, r.interface_name, _csv_time(r.created_at)],
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
    q: Optional[str] = Query(default=None),
    sort_by: Optional[str] = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
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
        q, sort_by, sort_dir, _TC_DOC_SEARCH,
    )


@router.get(
    "/test-case-document-events/export",
    response_model=List[TestCaseDocumentEventDetail],
    dependencies=[Depends(verify_dashboard_token)],
)
def test_case_document_events_export(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    sort_by: Optional[str] = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    format: str = Query(default="json", pattern="^(json|csv)$"),
    db: Session = Depends(get_db),
):
    items = _export_events(
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
        date_from, date_to, user_email, environment, search,
        q, sort_by, sort_dir, _TC_DOC_SEARCH,
    )
    return _maybe_csv(
        items, format, "testease-tc-documents.csv",
        ["User", "Environment", "Interface", "Suite", "Test cases", "Count", "Generated at"],
        lambda r: [
            r.user_email,
            r.environment or "",
            r.interface_name or "",
            r.suite_name,
            ", ".join(r.test_case_names),
            r.test_case_count,
            _csv_time(r.created_at),
        ],
    )


# --- Rollup: totals per (user, environment) pair, no day dimension. Same
# UNION ALL + GROUP BY shape as _users_branch, just without the report_date
# grouping key.
#
# The dashboard no longer calls this: the redesigned page derives its
# leaderboards, heatmap and hero facts from /users/export instead, because it
# needs the day dimension anyway (active-day counts, the detail drawer) and
# deriving every panel from one flat fact table is what guarantees they all
# agree. Kept as a supported endpoint for anything that wants the pair totals
# without the per-day rows.


def _user_env_branch(
    model,
    metric: str,
    date_from: date,
    date_to: date,
    user_email: Optional[List[str]],
    environment: Optional[List[str]],
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
        model.user_email.label("user_email"),
        model.environment.label("environment"),
        metric_cols["test_cases_created"].label("test_cases_created"),
        metric_cols["test_cases_executed"].label("test_cases_executed"),
        metric_cols["documents_generated"].label("documents_generated"),
        metric_cols["test_case_documents_generated"].label("test_case_documents_generated"),
    ).where(model.created_at >= start, model.created_at < end)
    if user_email:
        q = q.where(model.user_email.in_(user_email))
    for predicate in _search_predicate(model, environment, search):
        q = q.where(predicate)
    return q.group_by(model.user_email, model.environment)


@router.get(
    "/user-environment-rollup",
    response_model=List[UserEnvironmentStats],
    dependencies=[Depends(verify_dashboard_token)],
)
def user_environment_rollup(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
) -> List[UserEnvironmentStats]:
    branches = [
        _user_env_branch(model, metric, date_from, date_to, user_email, environment, search)
        for model, metric in (
            (TestCaseCreatedEvent, "test_cases_created"),
            (TestCaseExecutedEvent, "test_cases_executed"),
            (DocumentGeneratedEvent, "documents_generated"),
            (TestCaseDocumentGeneratedEvent, "test_case_documents_generated"),
        )
    ]
    combined = union_all(*branches).subquery()

    rows = db.execute(
        select(
            combined.c.user_email,
            combined.c.environment,
            func.sum(combined.c.test_cases_created).label("test_cases_created"),
            func.sum(combined.c.test_cases_executed).label("test_cases_executed"),
            func.sum(combined.c.documents_generated).label("documents_generated"),
            func.sum(combined.c.test_case_documents_generated).label("test_case_documents_generated"),
        )
        .group_by(combined.c.user_email, combined.c.environment)
        .order_by(combined.c.user_email, combined.c.environment)
    ).all()

    return [UserEnvironmentStats(**row._mapping) for row in rows]


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
