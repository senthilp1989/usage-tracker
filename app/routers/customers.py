"""The customer registry: the environment -> customer link, stored.

Read by the dashboard on load, written by the admin mapping tab. Resolution
itself lives on the client (frontend/src/customers.ts) - this router only
persists the three layers the spec describes:

  Layer 1  normalisation      already done on write (schemas._canonicalize_environment)
  Layer 2  customers + rules  seeded in migration 0010, read-only from here
  Layer 3  manual overrides   the writable part; an override always beats a rule

Same Bearer session as the rest of the dashboard. There is no per-user
identity in the token (the payload is just an expiry), so "admin" here means
"signed in" - a real role check needs an identity to check against first.
"""

from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..auth import verify_dashboard_token
from ..database import get_db
from ..models import Customer, EnvironmentMapping
from ..schemas import (
    CustomerOut,
    CustomerRegistryIn,
    CustomerRegistryOut,
    EnvironmentOverrideOut,
)

router = APIRouter(prefix="/customers", tags=["customers"])


def _registry(db: Session) -> CustomerRegistryOut:
    customers = (
        db.execute(select(Customer).options(selectinload(Customer.rules)).order_by(Customer.name)).scalars().all()
    )
    overrides = db.execute(select(EnvironmentMapping).order_by(EnvironmentMapping.name_normalised)).scalars().all()
    return CustomerRegistryOut(
        customers=[
            CustomerOut(
                id=c.id,
                name=c.name,
                is_internal=c.is_internal,
                patterns=[r.pattern for r in c.rules],
            )
            for c in customers
        ],
        overrides=[
            EnvironmentOverrideOut(name_normalised=o.name_normalised, customer_id=o.customer_id) for o in overrides
        ],
    )


@router.get("/registry", response_model=CustomerRegistryOut, dependencies=[Depends(verify_dashboard_token)])
def get_registry(db: Session = Depends(get_db)) -> CustomerRegistryOut:
    return _registry(db)


@router.put("/registry", response_model=CustomerRegistryOut, dependencies=[Depends(verify_dashboard_token)])
def put_registry(payload: CustomerRegistryIn, db: Session = Depends(get_db)) -> CustomerRegistryOut:
    # New manual-only customers first, so an override in the same payload can
    # point at one of them. An id that already exists is left as-is rather
    # than renamed: the seeded four are shipped configuration, and silently
    # rewriting one from a dashboard form is not something to do by accident.
    existing: Dict[str, Customer] = {
        c.id: c for c in db.execute(select(Customer)).scalars().all()
    }
    # `customers.name` is UNIQUE, and the dashboard groups on the *name*, so a
    # second customer sharing one would both violate the constraint and merge
    # two rollups into one row. Reject it with a message the admin screen can
    # show, rather than letting it surface as an IntegrityError 500.
    names = {c.name.casefold(): c.id for c in existing.values()}
    for incoming in payload.customers:
        if incoming.id in existing:
            continue
        clash = names.get(incoming.name.casefold())
        if clash is not None:
            raise HTTPException(
                status_code=409,
                detail=f"A customer named {incoming.name!r} already exists (id {clash!r}).",
            )
        created = Customer(id=incoming.id, name=incoming.name, is_internal=incoming.is_internal)
        db.add(created)
        existing[incoming.id] = created
        names[incoming.name.casefold()] = incoming.id
    db.flush()

    unknown = sorted(
        {e.customer_id for e in payload.environments if e.customer_id is not None} - set(existing)
    )
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown customer id(s): {', '.join(unknown)}")

    # The override set is replaced wholesale rather than merged. The admin
    # screen always sends the complete list, and only exceptions are ever in
    # it - clearing a row (or "Revert all") is an absence, which a merge could
    # not express.
    db.execute(delete(EnvironmentMapping))
    seen: set = set()
    for e in payload.environments:
        if e.name_normalised in seen:
            continue
        seen.add(e.name_normalised)
        db.add(
            EnvironmentMapping(
                name_normalised=e.name_normalised,
                customer_id=e.customer_id,
                resolved_by="manual",
            )
        )
    try:
        db.commit()
    except IntegrityError as exc:
        # Belt and braces for anything the checks above didn't anticipate: a
        # rolled-back session beats a 500 with a half-applied override set.
        db.rollback()
        raise HTTPException(status_code=409, detail="Registry conflict — nothing was saved.") from exc
    return _registry(db)


@router.get("", response_model=List[CustomerOut], dependencies=[Depends(verify_dashboard_token)])
def list_customers(db: Session = Depends(get_db)) -> List[CustomerOut]:
    return _registry(db).customers
