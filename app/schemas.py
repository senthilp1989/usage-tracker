from datetime import date, datetime

from pydantic import BaseModel, EmailStr


class UsageReportIn(BaseModel):
    stack_id: str
    user_email: EmailStr
    environment_id: str
    report_date: date
    test_cases_created: int = 0
    test_cases_executed: int = 0
    documents_generated: int = 0


class UsageReportOut(UsageReportIn):
    reported_at: datetime

    class Config:
        from_attributes = True


class LoginIn(BaseModel):
    username: str
    password: str


class LoginOut(BaseModel):
    token: str
    expires_at: datetime


class StatsSummary(BaseModel):
    users_reporting: int
    test_cases_created: int
    test_cases_executed: int
    documents_generated: int


class DailyStats(BaseModel):
    day: date
    test_cases_created: int
    test_cases_executed: int
    documents_generated: int


class UserStats(BaseModel):
    user_email: str
    environment_id: str
    report_date: date
    test_cases_created: int
    test_cases_executed: int
    documents_generated: int
    last_event_at: datetime
