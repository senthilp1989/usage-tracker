from datetime import date, datetime
from typing import Generic, List, Optional, TypeVar

from pydantic import BaseModel, EmailStr, field_validator

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: List[T]
    total: int


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


def _canonicalize_environment(value: str) -> str:
    # Case-only variants (Tarento_Dev vs TARENTO_DEV) were being counted as
    # distinct environments in every dashboard aggregate. Normalize to one
    # canonical casing per underscore segment on write, matching the
    # prevailing style already in the data. See migration 0007 for the
    # backfill of rows ingested before this existed.
    #
    # Whitespace is stripped for the same reason, and it's the nastier of the
    # two: "Heineken_Dev  " renders identically to "Heineken_Dev" in the
    # filter popover (HTML collapses trailing space), so the split showed up
    # as one environment listed twice with its activity halved. The source
    # name is free text that Test Ease does not trim, so strip per segment as
    # well as at the ends. See migration 0008 for that backfill.
    return "_".join(part.strip().capitalize() for part in value.strip().split("_"))


class TestCaseCreatedEventIn(BaseModel):
    user_email: EmailStr
    environment: str
    interface_name: str
    test_case_name: str
    created_at: datetime

    @field_validator("environment")
    @classmethod
    def _normalize_environment(cls, value: str) -> str:
        return _canonicalize_environment(value)


class TestCaseExecutedEventIn(BaseModel):
    user_email: EmailStr
    environment: str
    interface_name: str
    test_case_name: str
    status: str
    created_at: datetime

    @field_validator("environment")
    @classmethod
    def _normalize_environment(cls, value: str) -> str:
        return _canonicalize_environment(value)


class DocumentGeneratedEventIn(BaseModel):
    user_email: EmailStr
    environment: str
    interface_name: str
    created_at: datetime

    @field_validator("environment")
    @classmethod
    def _normalize_environment(cls, value: str) -> str:
        return _canonicalize_environment(value)


class TestCaseDocumentGeneratedEventIn(BaseModel):
    user_email: EmailStr
    environment: str
    interface_name: str
    suite_name: str
    test_case_names: List[str] = []
    test_case_count: int
    created_at: datetime

    @field_validator("environment")
    @classmethod
    def _normalize_environment(cls, value: str) -> str:
        return _canonicalize_environment(value)


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


class UserEnvironmentStats(BaseModel):
    user_email: str
    environment: str
    test_cases_created: int
    test_cases_executed: int
    documents_generated: int
    test_case_documents_generated: int


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


class DocumentEventDetail(BaseModel):
    user_email: str
    environment: str
    interface_name: str
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
