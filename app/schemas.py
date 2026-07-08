from datetime import date, datetime

from pydantic import BaseModel, EmailStr


class UsageReportIn(BaseModel):
    stack_id: str
    user_email: EmailStr
    report_date: date
    test_cases_created: int = 0
    test_cases_executed: int = 0
    documents_generated: int = 0


class UsageReportOut(UsageReportIn):
    reported_at: datetime

    class Config:
        from_attributes = True
