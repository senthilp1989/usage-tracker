from datetime import date, datetime
from zoneinfo import ZoneInfo

from pydantic import BaseModel, EmailStr, field_serializer

IST = ZoneInfo("Asia/Kolkata")


class UsageReportIn(BaseModel):
    user_email: EmailStr
    environment: str
    report_date: date
    test_cases_created: int = 0
    test_cases_executed: int = 0
    documents_generated: int = 0
    test_cases_passed: int = 0
    test_cases_failed: int = 0


class UsageReportOut(UsageReportIn):
    reported_at: datetime

    class Config:
        from_attributes = True

    @field_serializer("reported_at")
    def _reported_at_ist(self, value: datetime) -> datetime:
        return value.astimezone(IST)


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
    test_cases_passed: int
    test_cases_failed: int


class DailyStats(BaseModel):
    day: date
    test_cases_created: int
    test_cases_executed: int
    documents_generated: int
    test_cases_passed: int
    test_cases_failed: int


class UserStats(BaseModel):
    user_email: str
    environment: str
    report_date: date
    test_cases_created: int
    test_cases_executed: int
    documents_generated: int
    test_cases_passed: int
    test_cases_failed: int
    last_event_at: datetime

    @field_serializer("last_event_at")
    def _last_event_at_ist(self, value: datetime) -> datetime:
        return value.astimezone(IST)
