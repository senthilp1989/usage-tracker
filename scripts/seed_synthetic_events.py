#!/usr/bin/env python3
"""Generate synthetic Test Ease usage events and POST them to /events.

Everything goes through the real ingestion endpoint rather than straight into
Postgres, so the seeded rows get the same per-row validation, environment
canonicalization and ON CONFLICT backstop as production traffic. Re-running
with the same --seed is a no-op on rows that already landed (identical natural
keys), so it is safe to run repeatedly.

Usage:
    python scripts/seed_synthetic_events.py                     # 90 days, default profile
    python scripts/seed_synthetic_events.py --days 30 --scale 2
    python scripts/seed_synthetic_events.py --out payload.json --dry-run

Timestamps are naive IST wall-clock, exactly as Test Ease sends them.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, time, timedelta
from typing import Any, Dict, List

# --- Synthetic population -------------------------------------------------
#
# Users, environments and interfaces are stable across runs so repeated seeds
# stack up on the same dimensions instead of inventing a new cast every time.

USERS = [
    # (email, relative activity weight, home environments, favourite interfaces)
    ("aarti.menon@tarento.com", 1.6, ["Tarento_Dev", "Tarento_Qa"], ["OrderSync", "DeliveryNote", "PricingConditions"]),
    ("rahul.iyer@tarento.com", 1.3, ["Tarento_Qa", "Tarento_Uat"], ["MaterialMaster", "VendorMaster", "OrderSync"]),
    ("nisha.gupta@tarento.com", 1.1, ["Tarento_Dev"], ["InvoiceIdoc", "PricingConditions"]),
    ("vikram.rao@tarento.com", 0.9, ["Tarento_Uat", "Client_Sandbox"], ["GoodsReceipt", "DeliveryNote"]),
    ("sneha.pillai@tarento.com", 0.7, ["Tarento_Qa", "Client_Sandbox"], ["CustomerMaster", "InvoiceIdoc", "OrderSync"]),
    ("arjun.desai@tarento.com", 0.5, ["Client_Sandbox"], ["VendorMaster", "GoodsReceipt"]),
    ("meera.krishnan@tarento.com", 0.35, ["Tarento_Dev", "Tarento_Uat"], ["MaterialMaster", "CustomerMaster"]),
]

INTERFACES = [
    "OrderSync",
    "MaterialMaster",
    "InvoiceIdoc",
    "DeliveryNote",
    "VendorMaster",
    "PricingConditions",
    "GoodsReceipt",
    "CustomerMaster",
]

# Weighted so most executions look like a finished run; RUNNING/QUEUED rows are
# the "reported before it settled" case the pipeline knowingly never corrects.
STATUSES = ["PASSED"] * 68 + ["FAILED"] * 22 + ["ERROR"] * 6 + ["RUNNING"] * 3 + ["QUEUED"] * 1

SUITE_KINDS = ["Regression", "Smoke", "Sanity", "E2E", "Integration"]

WORKDAY_START = time(9, 30)
WORKDAY_END = time(18, 45)


def _stamp(rng: random.Random, day: date) -> datetime:
    """A naive IST timestamp inside the working day, skewed to mid-morning and
    mid-afternoon rather than uniform across the window."""
    start = datetime.combine(day, WORKDAY_START)
    span = (datetime.combine(day, WORKDAY_END) - start).total_seconds()
    # Two-hump distribution: a pre-lunch peak and a late-afternoon peak.
    center = 0.25 if rng.random() < 0.55 else 0.72
    frac = min(max(rng.gauss(center, 0.13), 0.0), 1.0)
    return start + timedelta(seconds=frac * span, microseconds=rng.randrange(1_000_000))


def _day_volume(rng: random.Random, day: date, weight: float, scale: float) -> int:
    """How many test cases this user creates on this day."""
    if day.weekday() >= 5:  # weekend: occasional catch-up work only
        if rng.random() > 0.18:
            return 0
        return max(0, int(rng.gauss(2, 1.5) * weight * scale))
    if rng.random() < 0.12:  # leave / meetings / a day on something else
        return 0
    base = rng.gauss(7.5, 3.5) * weight * scale
    if rng.random() < 0.07:  # occasional bulk authoring day
        base *= 2.6
    return max(0, int(base))


def build_payload(days: int, end_day: date, scale: float, seed: int) -> Dict[str, List[Dict[str, Any]]]:
    rng = random.Random(seed)
    created: List[Dict[str, Any]] = []
    executed: List[Dict[str, Any]] = []
    documents: List[Dict[str, Any]] = []
    suite_documents: List[Dict[str, Any]] = []

    counter = 0
    for offset in range(days - 1, -1, -1):
        day = end_day - timedelta(days=offset)
        # Adoption ramp: earlier days in the window are quieter than recent ones.
        ramp = 0.45 + 0.55 * ((days - offset) / days)

        for email, weight, home_envs, favourites in USERS:
            n_created = _day_volume(rng, day, weight * ramp, scale)
            if not n_created:
                continue

            environment = rng.choice(home_envs)
            day_cases: List[Dict[str, Any]] = []

            for _ in range(n_created):
                counter += 1
                interface = rng.choice(favourites) if rng.random() < 0.8 else rng.choice(INTERFACES)
                name = f"TC_{interface.upper()}_{counter:05d}"
                created_at = _stamp(rng, day)
                created.append(
                    {
                        "user_email": email,
                        "environment": environment,
                        "interface_name": interface,
                        "test_case_name": name,
                        "created_at": created_at.isoformat(timespec="milliseconds"),
                    }
                )
                day_cases.append({"name": name, "interface": interface, "created_at": created_at})

            # Executions: most authored cases get run at least once the same
            # day, some get re-run, and a few are never executed.
            executed_today: List[Dict[str, Any]] = []
            for case in day_cases:
                if rng.random() < 0.12:
                    continue
                runs = 1 if rng.random() < 0.72 else rng.randint(2, 4)
                for _ in range(runs):
                    run_at = case["created_at"] + timedelta(
                        minutes=rng.randint(2, 240), seconds=rng.randrange(60), microseconds=rng.randrange(1_000_000)
                    )
                    if run_at.date() != day:  # keep a run inside the day it started
                        run_at = datetime.combine(day, time(23, 30)) + timedelta(microseconds=rng.randrange(1_000_000))
                    executed.append(
                        {
                            "user_email": email,
                            "environment": environment,
                            "interface_name": case["interface"],
                            "test_case_name": case["name"],
                            "status": rng.choice(STATUSES),
                            "created_at": run_at.isoformat(timespec="milliseconds"),
                        }
                    )
                    executed_today.append(case)

            # Standalone document generation, roughly one per busy interface-day.
            for interface in {c["interface"] for c in day_cases}:
                if rng.random() < 0.35:
                    documents.append(
                        {
                            "user_email": email,
                            "environment": environment,
                            "interface_name": interface,
                            "created_at": _stamp(rng, day).isoformat(timespec="milliseconds"),
                        }
                    )

            # Consolidated test-suite report ("Generate Report" on a suite).
            if executed_today and rng.random() < 0.4:
                interface = rng.choice([c["interface"] for c in executed_today])
                pool = sorted({c["name"] for c in executed_today if c["interface"] == interface})
                picked = pool if len(pool) <= 6 else rng.sample(pool, rng.randint(3, 6))
                suite_documents.append(
                    {
                        "user_email": email,
                        "environment": environment,
                        "interface_name": interface,
                        "suite_name": f"{interface}_{rng.choice(SUITE_KINDS)}_Suite",
                        "test_case_names": sorted(picked),
                        "test_case_count": len(picked),
                        "created_at": _stamp(rng, day).isoformat(timespec="milliseconds"),
                    }
                )

    return {
        "test_cases_created": created,
        "test_cases_executed": executed,
        "documents_generated": documents,
        "test_case_documents_generated": suite_documents,
    }


def _chunks(payload: Dict[str, List[Dict[str, Any]]], size: int):
    """Split one big payload into batches shaped like a real reporting cycle."""
    keys = list(payload)
    offsets = {k: 0 for k in keys}
    while any(offsets[k] < len(payload[k]) for k in keys):
        batch = {}
        for k in keys:
            batch[k] = payload[k][offsets[k] : offsets[k] + size]
            offsets[k] += size
        yield batch


def post(url: str, api_key: str, batch: Dict[str, Any]) -> Dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(batch).encode(),
        headers={"Content-Type": "application/json", "X-API-Key": api_key},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default=os.environ.get("SEED_URL", "http://localhost:8000/events"))
    parser.add_argument("--api-key", default=os.environ.get("API_KEY"))
    parser.add_argument("--days", type=int, default=90, help="size of the window ending at --end-date")
    parser.add_argument("--end-date", default=None, help="last day of the window (YYYY-MM-DD, default: today)")
    parser.add_argument("--scale", type=float, default=1.0, help="multiplier on per-user daily volume")
    parser.add_argument("--seed", type=int, default=20260817, help="RNG seed; same seed = same rows")
    parser.add_argument("--batch-size", type=int, default=500, help="rows per list per POST")
    parser.add_argument("--out", default=None, help="also write the full generated payload here as JSON")
    parser.add_argument("--dry-run", action="store_true", help="generate only, do not POST")
    args = parser.parse_args()

    end_day = date.fromisoformat(args.end_date) if args.end_date else date.today()
    payload = build_payload(args.days, end_day, args.scale, args.seed)

    totals = {k: len(v) for k, v in payload.items()}
    print(f"Generated for {args.days} day(s) ending {end_day}:")
    for key, count in totals.items():
        print(f"  {key:32s} {count:6d}")

    if args.out:
        with open(args.out, "w") as handle:
            json.dump(payload, handle, indent=2)
        print(f"Wrote payload to {args.out}")

    if args.dry_run:
        return 0

    if not args.api_key:
        print("error: --api-key (or API_KEY in the environment) is required to POST", file=sys.stderr)
        return 2

    accepted = {k: 0 for k in totals}
    rejected: List[Dict[str, Any]] = []
    for index, batch in enumerate(_chunks(payload, args.batch_size), start=1):
        try:
            result = post(args.url, args.api_key, batch)
        except urllib.error.HTTPError as exc:
            print(f"batch {index} failed: HTTP {exc.code} {exc.read().decode()[:400]}", file=sys.stderr)
            return 1
        except urllib.error.URLError as exc:
            print(f"batch {index} failed: {exc.reason} (is the API running at {args.url}?)", file=sys.stderr)
            return 1
        for key in accepted:
            accepted[key] += result.get(key, 0)
        rejected.extend(result.get("rejected", []))
        print(f"  batch {index}: {sum(len(v) for v in batch.values())} rows posted")

    print("Accepted by the API:")
    for key, count in accepted.items():
        print(f"  {key:32s} {count:6d}")
    if rejected:
        print(f"Rejected rows: {len(rejected)} (first 5 shown)")
        for item in rejected[:5]:
            print(f"  {item}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
