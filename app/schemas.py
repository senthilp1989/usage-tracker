from datetime import date, datetime
from typing import List, Optional
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


# --- Raw event ingestion (POST /events) ---
#
# created_at on all three of these arrives as a naive datetime string -
# the source tool shifts it to IST once before sending, so it's stored and
# read back as-is with no timezone attached (see models.py). Do not add a
# field_serializer/astimezone conversion here or in the dashboard schemas
# below - that per-row conversion is exactly what sending pre-shifted IST
# values was meant to avoid.


class TestCaseCreatedEventIn(BaseModel):
    user_email: EmailStr
    environment: str
    interface_name: str
    test_case_name: str
    created_at: datetime


class TestCaseExecutedEventIn(BaseModel):
    user_email: EmailStr
    environment: str
    interface_name: str
    test_case_name: str
    status: str
    created_at: datetime


class DocumentGeneratedEventIn(BaseModel):
    user_email: EmailStr
    environment: str
    interface_name: str
    created_at: datetime


class TestCaseDocumentGeneratedEventIn(BaseModel):
    user_email: EmailStr
    environment: str
    interface_name: str
    suite_name: str
    test_case_names: List[str] = []
    test_case_count: int
    created_at: datetime


class UsageEventsIn(BaseModel):
    test_cases_created: List[TestCaseCreatedEventIn] = []
    test_cases_executed: List[TestCaseExecutedEventIn] = []
    documents_generated: List[DocumentGeneratedEventIn] = []
    test_case_documents_generated: List[TestCaseDocumentGeneratedEventIn] = []


class RejectedEvent(BaseModel):
    event_type: str
    index: int
    reason: str


class UsageEventsAccepted(BaseModel):
    test_cases_created: int
    test_cases_executed: int
    documents_generated: int
    test_case_documents_generated: int
    rejected: List[RejectedEvent] = []


# --- Dashboard aggregates (all computed at query time from the raw event
# tables above) ---


class StatsSummary(BaseModel):
    users_reporting: int
    test_cases_created: int
    test_cases_executed: int
    documents_generated: int
    test_case_documents_generated: int


class DailyStats(BaseModel):
    day: date
    test_cases_created: int
    test_cases_executed: int
    documents_generated: int
    test_case_documents_generated: int


class UserStats(BaseModel):
    user_email: str
    environment: str
    report_date: date
    test_cases_created: int
    test_cases_executed: int
    documents_generated: int
    test_case_documents_generated: int
    last_event_at: datetime


class ArtifactStats(BaseModel):
    environment: str
    interface_name: str
    test_cases_created: int
    test_cases_executed: int
    documents_generated: int
    test_case_documents_generated: int


class CreatedEventDetail(BaseModel):
    user_email: str
    environment: str
    interface_name: str
    test_case_name: str
    created_at: datetime


class ExecutedEventDetail(BaseModel):
    user_email: str
    environment: str
    interface_name: str
    test_case_name: str
    created_at: datetime


class TestCaseDocumentEventDetail(BaseModel):
    user_email: str
    environment: Optional[str]
    interface_name: Optional[str]
    suite_name: str
    test_case_names: List[str]
    test_case_count: int
    created_at: datetime
