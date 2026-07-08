import hmac
from datetime import date, datetime, time, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, distinct, func
from sqlalchemy.orm import Session

from ..auth import create_dashboard_token, verify_dashboard_token
from ..config import settings
from ..database import get_db
from ..models import UsageEvent
from ..schemas import DailyStats, LoginIn, LoginOut, StatsSummary, UserStats

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

EVENT_TYPES = ("test_case_created", "test_case_executed", "document_generated")


@router.post("/login", response_model=LoginOut)
def login(payload: LoginIn) -> LoginOut:
    user_ok = hmac.compare_digest(payload.username, settings.dashboard_username)
    pass_ok = hmac.compare_digest(payload.password, settings.dashboard_password)
    if not (user_ok and pass_ok):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token, expires = create_dashboard_token()
    return LoginOut(token=token, expires_at=datetime.fromtimestamp(expires, tz=timezone.utc))


def _scoped(query, date_from: date, date_to: date, user_email: Optional[str]):
    query = query.filter(
        UsageEvent.occurred_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc),
        UsageEvent.occurred_at < datetime.combine(date_to, time.max, tzinfo=timezone.utc),
    )
    if user_email:
        query = query.filter(UsageEvent.user_email == user_email)
    return query


def _type_counts():
    return [
        func.coalesce(func.sum(case((UsageEvent.event_type == t, 1), else_=0)), 0).label(t)
        for t in EVENT_TYPES
    ]


@router.get("/summary", response_model=StatsSummary, dependencies=[Depends(verify_dashboard_token)])
def summary(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[str] = None,
    db: Session = Depends(get_db),
) -> StatsSummary:
    row = _scoped(
        db.query(func.count(distinct(UsageEvent.user_email)).label("users"), *_type_counts()),
        date_from, date_to, user_email,
    ).one()
    return StatsSummary(
        users_reporting=row.users,
        test_cases_created=row.test_case_created,
        test_cases_executed=row.test_case_executed,
        documents_generated=row.document_generated,
    )


@router.get("/daily", response_model=List[DailyStats], dependencies=[Depends(verify_dashboard_token)])
def daily(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    user_email: Optional[str] = None,
    db: Session = Depends(get_db),
) -> List[DailyStats]:
    day = func.date(UsageEvent.occurred_at).label("day")
    rows = (
        _scoped(db.query(day, *_type_counts()), date_from, date_to, user_email)
        .group_by(day)
        .order_by(day)
        .all()
    )
    return [
        DailyStats(
            day=r.day,
            test_cases_created=r.test_case_created,
            test_cases_executed=r.test_case_executed,
            documents_generated=r.document_generated,
        )
        for r in rows
    ]


@router.get("/users", response_model=List[UserStats], dependencies=[Depends(verify_dashboard_token)])
def users(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    db: Session = Depends(get_db),
) -> List[UserStats]:
    rows = (
        _scoped(
            db.query(
                UsageEvent.user_email,
                *_type_counts(),
                func.max(UsageEvent.occurred_at).label("last_event_at"),
            ),
            date_from, date_to, None,
        )
        .group_by(UsageEvent.user_email)
        .order_by(UsageEvent.user_email)
        .all()
    )
    return [
        UserStats(
            user_email=r.user_email,
            test_cases_created=r.test_case_created,
            test_cases_executed=r.test_case_executed,
            documents_generated=r.document_generated,
            last_event_at=r.last_event_at,
        )
        for r in rows
    ]


@router.get("/user-emails", response_model=List[str], dependencies=[Depends(verify_dashboard_token)])
def user_emails(db: Session = Depends(get_db)) -> List[str]:
    return [r[0] for r in db.query(UsageEvent.user_email).distinct().order_by(UsageEvent.user_email).all()]
