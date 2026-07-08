from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr

EventType = Literal["test_case_created", "test_case_executed", "document_generated"]


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


class UsageEventIn(BaseModel):
    stack_id: str
    user_email: EmailStr
    event_type: EventType
    occurred_at: Optional[datetime] = None  # defaults to receipt time


class UsageEventOut(BaseModel):
    id: int
    stack_id: str
    user_email: EmailStr
    event_type: EventType
    occurred_at: datetime
    created_at: datetime

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
    test_cases_created: int
    test_cases_executed: int
    documents_generated: int
    last_event_at: datetime
