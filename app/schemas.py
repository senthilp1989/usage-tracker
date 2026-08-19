import re
from datetime import date, datetime
from typing import Generic, List, Optional, TypeVar

from pydantic import BaseModel, EmailStr, Field, field_validator

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
    # Distinct calendar days / environments with any activity in scope - the
    # hero facts the frontend used to derive from the flat /users/export rows.
    active_days: int
    environments_active: int


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


# The /rollup twins keep the four metrics as separate columns on purpose: the
# frontend's legend toggles re-total client-side from whichever metrics are
# switched on, so a pre-summed total would turn every toggle into a refetch.


class UserRollupStats(BaseModel):
    user_email: str
    test_cases_created: int
    test_cases_executed: int
    documents_generated: int
    test_case_documents_generated: int
    active_days: int
    environments: int


class EnvironmentRollupStats(BaseModel):
    environment: str
    test_cases_created: int
    test_cases_executed: int
    documents_generated: int
    test_case_documents_generated: int
    active_days: int
    users: int


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


# --- Customer registry (GET/PUT /customers/registry) ---
#
# The registry is a *store*, not a resolver: these shapes carry the customers,
# their patterns and the manual overrides, and the dashboard applies them to
# the environment dimension of the aggregates it already has. Keeping
# resolution in one place (the client) is what stops a customer rollup and an
# environment rollup from ever disagreeing - they are the same rows, folded
# one level further.


class CustomerOut(BaseModel):
    id: str
    name: str
    is_internal: bool
    patterns: List[str]


class EnvironmentOverrideOut(BaseModel):
    name_normalised: str
    # None is an explicit "leave unassigned", which still beats a matching rule.
    customer_id: Optional[str]


class CustomerRegistryOut(BaseModel):
    customers: List[CustomerOut]
    overrides: List[EnvironmentOverrideOut]


class CustomerIn(BaseModel):
    # At least one alphanumeric, so an id of bare separators can't be stored.
    # Keeping a punctuation-only *name* from slugging down to the shared "c_"
    # prefix is the client's job (customers.ts `customerSlug` returns "" for
    # one, and the admin screen refuses it) - the prefix convention is a
    # client concern and this validator shouldn't encode it.
    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_]*[a-z0-9][a-z0-9_]*$")
    name: str = Field(min_length=1, max_length=255)
    is_internal: bool = False

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("name cannot be blank")
        return name


def _normalise_environment_key(value: str) -> str:
    # The same transform the client resolver applies before matching
    # (customers.ts normalizeEnv): case-fold, trim, collapse `-`/whitespace to
    # `_`. Applied again here so a caller that sends a raw name gets a row
    # that actually matches at read time - storing "Tarento_Dev" verbatim
    # would sit in the table looking like a live override while the resolver,
    # which looks up "tarento_dev", never finds it.
    return re.sub(r"[\s-]+", "_", value.strip().lower())


class EnvironmentOverrideIn(BaseModel):
    name_normalised: str = Field(min_length=1, max_length=255)
    customer_id: Optional[str] = None

    @field_validator("name_normalised")
    @classmethod
    def _normalise(cls, value: str) -> str:
        return _normalise_environment_key(value)


class CustomerRegistryIn(BaseModel):
    """A full replacement of the override set, plus any manual-only customers
    the admin screen created. `environments` is authoritative: whatever isn't
    in it is dropped, which is how "reset this row" and "Revert all" persist.
    Seeded customers and their patterns are never touched from here - adding a
    pattern is a registry migration, not a dashboard action."""

    customers: List[CustomerIn] = []
    environments: List[EnvironmentOverrideIn] = []
