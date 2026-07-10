from datetime import datetime, timezone
from typing import List, Union

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


def _upsert_one(payload: UsageReportIn, db: Session) -> UsageReport:
    report = (
        db.query(UsageReport)
        .filter_by(
            user_email=payload.user_email,
            report_date=payload.report_date,
            environment=payload.environment,
        )
        .first()
    )
    if report is None:
        report = UsageReport(**payload.model_dump())
        db.add(report)
    else:
        report.test_cases_created = payload.test_cases_created
        report.test_cases_executed = payload.test_cases_executed
        report.documents_generated = payload.documents_generated
        report.reported_at = datetime.now(timezone.utc)

    # Flush (not commit) so a later item in the same batch that shares this
    # item's (user_email, report_date, environment) key sees it as an
    # update rather than colliding with the unique constraint on commit.
    db.flush()
    return report


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
