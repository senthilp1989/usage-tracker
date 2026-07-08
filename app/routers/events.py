from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import verify_api_key
from ..database import get_db
from ..models import UsageEvent
from ..schemas import UsageEventIn, UsageEventOut

router = APIRouter(prefix="/events", tags=["events"])


@router.post("", response_model=UsageEventOut, status_code=201, dependencies=[Depends(verify_api_key)])
def create_event(payload: UsageEventIn, db: Session = Depends(get_db)) -> UsageEvent:
    event = UsageEvent(
        stack_id=payload.stack_id,
        user_email=payload.user_email,
        event_type=payload.event_type,
        occurred_at=payload.occurred_at or datetime.now(timezone.utc),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event
