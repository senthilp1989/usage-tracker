import hmac
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import create_dashboard_token, verify_dashboard_token
from ..config import settings
from ..database import get_db
from ..models import UsageReport
from ..schemas import DailyStats, LoginIn, LoginOut, StatsSummary, UserStats

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.post("/login", response_model=LoginOut)
def login(payload: LoginIn) -> LoginOut:
    user_ok = hmac.compare_digest(payload.username, settings.dashboard_username)
    pass_ok = hmac.compare_digest(payload.password, settings.dashboard_password)
    if not (user_ok and pass_ok):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token, expires = create_dashboard_token()
    return LoginOut(token=token, expires_at=datetime.fromtimestamp(expires, tz=timezone.utc))


def _scoped(
    query,
    date_from: date,
    date_to: date,
    user_email: Optional[List[str]],
    environment: Optional[List[str]] = None,
):
    query = query.filter(UsageReport.report_date >= date_from, UsageReport.report_date <= date_to)
    if user_email:
        query = query.filter(UsageReport.user_email.in_(user_email))
    if environment:
        query = query.filter(UsageReport.environment.in_(environment))
    return query


def _totals():
    return [
        func.coalesce(func.sum(UsageReport.test_cases_created), 0).label("test_cases_created"),
        func.coalesce(func.sum(UsageReport.test_cases_executed), 0).label("test_cases_executed"),
        func.coalesce(func.sum(UsageReport.documents_generated), 0).label("documents_generated"),
        func.coalesce(func.sum(UsageReport.test_cases_passed), 0).label("test_cases_passed"),
        func.coalesce(func.sum(UsageReport.test_cases_failed), 0).label("test_cases_failed"),
    ]


@router.get("/summary", response_model=StatsSummary, dependencies=[Depends(verify_dashboard_token)])
def summary(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    db: Session = Depends(get_db),
) -> StatsSummary:
    row = _scoped(
        db.query(func.count(func.distinct(UsageReport.user_email)).label("users"), *_totals()),
        date_from, date_to, user_email, environment,
    ).one()
    return StatsSummary(
        users_reporting=row.users,
        test_cases_created=row.test_cases_created,
        test_cases_executed=row.test_cases_executed,
        documents_generated=row.documents_generated,
        test_cases_passed=row.test_cases_passed,
        test_cases_failed=row.test_cases_failed,
    )


@router.get("/daily", response_model=List[DailyStats], dependencies=[Depends(verify_dashboard_token)])
def daily(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    db: Session = Depends(get_db),
) -> List[DailyStats]:
    day = UsageReport.report_date.label("day")
    rows = (
        _scoped(db.query(day, *_totals()), date_from, date_to, user_email, environment)
        .group_by(day)
        .order_by(day)
        .all()
    )
    return [
        DailyStats(
            day=r.day,
            test_cases_created=r.test_cases_created,
            test_cases_executed=r.test_cases_executed,
            documents_generated=r.documents_generated,
            test_cases_passed=r.test_cases_passed,
            test_cases_failed=r.test_cases_failed,
        )
        for r in rows
    ]


@router.get("/users", response_model=List[UserStats], dependencies=[Depends(verify_dashboard_token)])
def users(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[List[str]] = Query(default=None),
    environment: Optional[List[str]] = Query(default=None),
    db: Session = Depends(get_db),
) -> List[UserStats]:
    rows = (
        _scoped(
            db.query(
                UsageReport.user_email,
                UsageReport.environment,
                UsageReport.report_date,
                *_totals(),
                func.max(UsageReport.reported_at).label("last_event_at"),
            ),
            date_from, date_to, user_email, environment,
        )
        .group_by(UsageReport.user_email, UsageReport.environment, UsageReport.report_date)
        .order_by(UsageReport.user_email, UsageReport.environment, UsageReport.report_date)
        .all()
    )
    return [
        UserStats(
            user_email=r.user_email,
            environment=r.environment,
            report_date=r.report_date,
            test_cases_created=r.test_cases_created,
            test_cases_executed=r.test_cases_executed,
            documents_generated=r.documents_generated,
            test_cases_passed=r.test_cases_passed,
            test_cases_failed=r.test_cases_failed,
            last_event_at=r.last_event_at,
        )
        for r in rows
    ]


@router.get("/user-emails", response_model=List[str], dependencies=[Depends(verify_dashboard_token)])
def user_emails(db: Session = Depends(get_db)) -> List[str]:
    return [r[0] for r in db.query(UsageReport.user_email).distinct().order_by(UsageReport.user_email).all()]


@router.get("/environments", response_model=List[str], dependencies=[Depends(verify_dashboard_token)])
def environments(db: Session = Depends(get_db)) -> List[str]:
    return [
        r[0]
        for r in db.query(UsageReport.environment).distinct().order_by(UsageReport.environment).all()
    ]
