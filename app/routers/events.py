import logging
from typing import Any, Dict, List, Tuple, Type

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ValidationError
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..auth import verify_api_key
from ..database import get_db
from ..models import DocumentGeneratedEvent, TestCaseCreatedEvent, TestCaseExecutedEvent
from ..schemas import (
    DocumentGeneratedEventIn,
    RejectedEvent,
    TestCaseCreatedEventIn,
    TestCaseExecutedEventIn,
    UsageEventsAccepted,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/events", tags=["events"])


def _validate_each(
    event_type: str, raw_items: Any, schema: Type[BaseModel]
) -> Tuple[List[BaseModel], List[RejectedEvent]]:
    # Validated one row at a time (not as a single list) so one malformed
    # row - e.g. a non-RFC-compliant user_email - doesn't reject the entire
    # batch. Checkpoints upstream only advance on a successful send, so an
    # all-or-nothing failure here would turn one bad row into a permanent
    # block on every retry; per-row validation just drops that row and lets
    # everything else through.
    valid: List[BaseModel] = []
    rejected: List[RejectedEvent] = []
    for index, item in enumerate(raw_items or []):
        try:
            valid.append(schema.model_validate(item))
        except ValidationError as exc:
            reason = "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors())
            rejected.append(RejectedEvent(event_type=event_type, index=index, reason=reason))
    return valid, rejected


@router.post("", response_model=UsageEventsAccepted, dependencies=[Depends(verify_api_key)])
def ingest_events(payload: Dict[str, Any], db: Session = Depends(get_db)) -> UsageEventsAccepted:
    created_valid, created_rejected = _validate_each(
        "test_cases_created", payload.get("test_cases_created"), TestCaseCreatedEventIn
    )
    executed_valid, executed_rejected = _validate_each(
        "test_cases_executed", payload.get("test_cases_executed"), TestCaseExecutedEventIn
    )
    documents_valid, documents_rejected = _validate_each(
        "documents_generated", payload.get("documents_generated"), DocumentGeneratedEventIn
    )

    # Plain inserts, not upserts - these are immutable, append-only events.
    # ON CONFLICT DO NOTHING is only a backstop against the source tool
    # resending a window it already sent (e.g. after losing its checkpoint
    # state file), not a normal code path - see usage-metrics.md upstream.
    if created_valid:
        db.execute(
            pg_insert(TestCaseCreatedEvent)
            .values([item.model_dump() for item in created_valid])
            .on_conflict_do_nothing(constraint="uq_test_case_created_events_natural_key")
        )
    if executed_valid:
        db.execute(
            pg_insert(TestCaseExecutedEvent)
            .values([item.model_dump() for item in executed_valid])
            .on_conflict_do_nothing(constraint="uq_test_case_executed_events_natural_key")
        )
    if documents_valid:
        db.execute(
            pg_insert(DocumentGeneratedEvent)
            .values([item.model_dump() for item in documents_valid])
            .on_conflict_do_nothing(constraint="uq_document_generated_events_natural_key")
        )
    db.commit()

    rejected = created_rejected + executed_rejected + documents_rejected
    for r in rejected:
        logger.warning("Rejected %s[%d]: %s", r.event_type, r.index, r.reason)

    return UsageEventsAccepted(
        test_cases_created=len(created_valid),
        test_cases_executed=len(executed_valid),
        documents_generated=len(documents_valid),
        rejected=rejected,
    )
