from typing import List, Union

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..auth import verify_api_key
from ..database import get_db
from ..models import UsageReport
from ..schemas import UsageReportIn, UsageReportOut

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("", response_model=List[UsageReportOut], dependencies=[Depends(verify_api_key)])
def list_reports(db: Session = Depends(get_db)) -> List[UsageReport]:
    return (
        db.query(UsageReport)
        .order_by(UsageReport.report_date.desc(), UsageReport.user_email)
        .all()
    )


def _upsert_one(payload: UsageReportIn, db: Session) -> UsageReport:
    # Atomic upsert: lets Postgres handle the conflict check instead of a
    # separate SELECT-then-insert/update, which could race between two
    # concurrent requests for the same (user_email, report_date, environment).
    stmt = (
        pg_insert(UsageReport)
        .values(**payload.model_dump())
        .on_conflict_do_update(
            constraint="uq_usage_reports_user_date_env",
            set_={
                "test_cases_created": payload.test_cases_created,
                "test_cases_executed": payload.test_cases_executed,
                "documents_generated": payload.documents_generated,
                "reported_at": func.now(),
            },
        )
        .returning(UsageReport)
    )
    return db.scalars(stmt).one()


@router.post("", response_model=Union[UsageReportOut, List[UsageReportOut]], dependencies=[Depends(verify_api_key)])
def upsert_report(
    payload: Union[UsageReportIn, List[UsageReportIn]], db: Session = Depends(get_db)
) -> Union[UsageReport, List[UsageReport]]:
    if isinstance(payload, list):
        reports = [_upsert_one(item, db) for item in payload]
        db.commit()
        for report in reports:
            db.refresh(report)
        return reports

    report = _upsert_one(payload, db)
    db.commit()
    db.refresh(report)
    return report
