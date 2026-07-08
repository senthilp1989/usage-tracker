from sqlalchemy import Column, Date, DateTime, Index, Integer, String, UniqueConstraint, func

from .database import Base


class UsageEvent(Base):
    """Append-only log: one row per tracked user action, written by Test Ease
    at the moment the action happens. All dashboard numbers are aggregated
    from this table at query time. `occurred_at` is when the action happened
    (client-supplied, defaults to receipt time); `created_at` is when we stored it."""

    __tablename__ = "usage_events"
    __table_args__ = (Index("ix_usage_events_occurred_type", "occurred_at", "event_type"),)

    id = Column(Integer, primary_key=True)
    stack_id = Column(String(255), nullable=False)
    user_email = Column(String(255), nullable=False, index=True)
    event_type = Column(String(50), nullable=False)
    occurred_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class UsageReport(Base):
    """One row per user per day. Each incoming report overwrites today's row
    with the latest total-so-far, since deployments only check in intermittently.
    `reported_at` reflects the last time this row was actually written to,
    so you can tell how stale a user's number is."""

    __tablename__ = "usage_reports"
    __table_args__ = (UniqueConstraint("user_email", "report_date", name="uq_usage_reports_user_date"),)

    id = Column(Integer, primary_key=True)
    stack_id = Column(String(255), nullable=False)
    user_email = Column(String(255), nullable=False, index=True)
    report_date = Column(Date, nullable=False, index=True)
    test_cases_created = Column(Integer, nullable=False, default=0)
    test_cases_executed = Column(Integer, nullable=False, default=0)
    documents_generated = Column(Integer, nullable=False, default=0)
    reported_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
