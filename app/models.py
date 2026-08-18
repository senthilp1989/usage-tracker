from sqlalchemy import Column, DateTime, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB

from .database import Base

# Server-computed IST ("Asia/Kolkata") wall-clock, stored with no timezone
# attached - matches how the source tool sends created_at (shifted to IST
# once, then sent naive), so reported_at needs the same shift applied once
# here rather than at every read.
_IST_NOW = text("(now() AT TIME ZONE 'Asia/Kolkata')")


class TestCaseCreatedEvent(Base):
    """One row per test case creation, as reported by the source tool - no
    aggregation happens on ingestion; counts/breakdowns are derived by
    querying/grouping this table at read time. created_at is IST wall-clock
    (naive, no tz attached) - the source tool converts once before sending,
    so no timezone math is ever needed here, which matters once this table
    has many rows to scan."""

    __tablename__ = "test_case_created_events"
    __table_args__ = (
        UniqueConstraint(
            "user_email", "environment", "interface_name", "test_case_name", "created_at",
            name="uq_test_case_created_events_natural_key",
        ),
    )

    id = Column(Integer, primary_key=True)
    user_email = Column(String(255), nullable=False, index=True)
    environment = Column(String(255), nullable=False, index=True)
    interface_name = Column(String(255), nullable=False, index=True)
    test_case_name = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=False), nullable=False, index=True)
    reported_at = Column(DateTime(timezone=False), nullable=False, server_default=_IST_NOW)


class TestCaseExecutedEvent(Base):
    """One row per test case execution. `status` is whatever the execution's
    status was at send time - the source tool holds rows back for 30 minutes
    after they start so most have already reached a terminal status
    (PASSED/FAILED/etc.) before being reported, but this is a one-shot
    insert, not an upsert, so a still-running execution's status is never
    corrected later."""

    __tablename__ = "test_case_executed_events"
    __table_args__ = (
        UniqueConstraint(
            "user_email", "environment", "interface_name", "test_case_name", "created_at",
            name="uq_test_case_executed_events_natural_key",
        ),
    )

    id = Column(Integer, primary_key=True)
    user_email = Column(String(255), nullable=False, index=True)
    environment = Column(String(255), nullable=False, index=True)
    interface_name = Column(String(255), nullable=False, index=True)
    test_case_name = Column(String(255), nullable=False)
    status = Column(String(50), nullable=False, index=True)
    created_at = Column(DateTime(timezone=False), nullable=False, index=True)
    reported_at = Column(DateTime(timezone=False), nullable=False, server_default=_IST_NOW)


class DocumentGeneratedEvent(Base):
    """One row per generated document, as reported by the source tool."""

    __tablename__ = "document_generated_events"
    __table_args__ = (
        UniqueConstraint(
            "user_email", "environment", "interface_name", "created_at",
            name="uq_document_generated_events_natural_key",
        ),
    )

    id = Column(Integer, primary_key=True)
    user_email = Column(String(255), nullable=False, index=True)
    environment = Column(String(255), nullable=False, index=True)
    interface_name = Column(String(255), nullable=False, index=True)
    created_at = Column(DateTime(timezone=False), nullable=False, index=True)
    reported_at = Column(DateTime(timezone=False), nullable=False, server_default=_IST_NOW)


class TestCaseDocumentGeneratedEvent(Base):
    """One row per "Generate Report" click on a test suite's consolidated test
    execution document (Word/PDF), as reported by the source tool. Unlike the
    other three event tables, `environment` and `interface_name` are nullable -
    the source tool resolves them from the test suite at log time, and a suite
    with no environment/interface assigned yet still needs to log the click."""

    __tablename__ = "test_case_document_generated_events"
    __table_args__ = (
        UniqueConstraint(
            "user_email", "environment", "interface_name", "suite_name", "created_at",
            name="uq_test_case_document_generated_events_natural_key",
        ),
    )

    id = Column(Integer, primary_key=True)
    user_email = Column(String(255), nullable=False, index=True)
    environment = Column(String(255), nullable=True, index=True)
    interface_name = Column(String(255), nullable=True, index=True)
    suite_name = Column(String(255), nullable=False, index=True)
    test_case_names = Column(JSONB, nullable=False)
    test_case_count = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=False), nullable=False, index=True)
    reported_at = Column(DateTime(timezone=False), nullable=False, server_default=_IST_NOW)
