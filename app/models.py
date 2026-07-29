from sqlalchemy import Column, Date, DateTime, Integer, String, UniqueConstraint, func

from .database import Base


class UsageReport(Base):
    """One row per user per environment per day. Each incoming report overwrites
    that row with the latest total-so-far, since deployments only check in
    intermittently. `reported_at` reflects the last time this row was actually
    written to, so you can tell how stale a user's number is."""

    __tablename__ = "usage_reports"
    __table_args__ = (
        UniqueConstraint("user_email", "report_date", "environment", name="uq_usage_reports_user_date_env"),
    )

    id = Column(Integer, primary_key=True)
    user_email = Column(String(255), nullable=False, index=True)
    environment = Column(String(255), nullable=False)
    report_date = Column(Date, nullable=False, index=True)
    test_cases_created = Column(Integer, nullable=False, default=0)
    test_cases_executed = Column(Integer, nullable=False, default=0)
    documents_generated = Column(Integer, nullable=False, default=0)
    test_cases_passed = Column(Integer, nullable=False, default=0)
    test_cases_failed = Column(Integer, nullable=False, default=0)
    reported_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
