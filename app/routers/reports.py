from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends
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


@router.post("", response_model=UsageReportOut, dependencies=[Depends(verify_api_key)])
def upsert_report(payload: UsageReportIn, db: Session = Depends(get_db)) -> UsageReport:
    report = (
        db.query(UsageReport)
        .filter_by(user_email=payload.user_email, report_date=payload.report_date)
        .first()
    )
    if report is None:
        report = UsageReport(**payload.model_dump())
        db.add(report)
    else:
        report.stack_id = payload.stack_id
        report.test_cases_created = payload.test_cases_created
        report.test_cases_executed = payload.test_cases_executed
        report.documents_generated = payload.documents_generated
        report.reported_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(report)
    return report
