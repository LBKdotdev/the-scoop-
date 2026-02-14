from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc, func, and_
from pydantic import BaseModel
from datetime import datetime, timedelta, date
from typing import List
from database import get_db
from models import DailyCount, Production, Flavor, ParLevel

router = APIRouter(prefix="/api/counts", tags=["counts"])


class CountEntry(BaseModel):
    flavor_id: int
    product_type: str  # tub, pint, quart
    count: float


class CountBatch(BaseModel):
    entries: List[CountEntry]


@router.post("", status_code=201)
def submit_counts(batch: CountBatch, db: Session = Depends(get_db)):
    saved = []
    for entry in batch.entries:
        if entry.product_type not in ("tub", "pint", "quart"):
            raise HTTPException(400, f"Invalid product_type: {entry.product_type}")
        record = DailyCount(
            flavor_id=entry.flavor_id,
            product_type=entry.product_type,
            count=entry.count,
        )
        db.add(record)
        saved.append(record)
    db.commit()
    return {"message": f"Saved {len(saved)} count entries"}


@router.get("/smart-defaults")
def get_smart_defaults(db: Session = Depends(get_db)):
    """Calculate smart defaults for tonight's count.

    Formula: estimated = last_count + produced_since - avg_daily_consumption
    """
    flavors = db.query(Flavor).filter(Flavor.active == True).all()

    # Build set of (flavor_id, product_type) with par target > 0
    active_pars = set()
    for par in db.query(ParLevel).all():
        if par.target > 0:
            active_pars.add((par.flavor_id, par.product_type))

    defaults = []

    for flavor in flavors:
        for ptype in ("tub", "pint", "quart"):
            # Skip product types with no par target set
            if (flavor.id, ptype) not in active_pars:
                continue
            # Get last count for this flavor+type
            last_count_row = (
                db.query(DailyCount)
                .filter(
                    DailyCount.flavor_id == flavor.id,
                    DailyCount.product_type == ptype,
                )
                .order_by(desc(DailyCount.counted_at))
                .first()
            )
            last_count = last_count_row.count if last_count_row else 0
            last_count_time = (
                last_count_row.counted_at
                if last_count_row
                else datetime.utcnow() - timedelta(days=1)
            )

            # Production since last count
            produced = (
                db.query(func.coalesce(func.sum(Production.quantity), 0))
                .filter(
                    Production.flavor_id == flavor.id,
                    Production.product_type == ptype,
                    Production.logged_at > last_count_time,
                )
                .scalar()
            )

            # Average daily consumption (from last 7 days of counts)
            week_ago = datetime.utcnow() - timedelta(days=7)
            recent_counts = (
                db.query(DailyCount)
                .filter(
                    DailyCount.flavor_id == flavor.id,
                    DailyCount.product_type == ptype,
                    DailyCount.counted_at >= week_ago,
                )
                .order_by(DailyCount.counted_at)
                .all()
            )

            avg_consumption = 0
            if len(recent_counts) >= 2:
                # Calculate consumption between consecutive counts
                total_consumed = 0
                count_pairs = 0
                for i in range(1, len(recent_counts)):
                    prev = recent_counts[i - 1]
                    curr = recent_counts[i]
                    # Get production between these two counts
                    prod_between = (
                        db.query(func.coalesce(func.sum(Production.quantity), 0))
                        .filter(
                            Production.flavor_id == flavor.id,
                            Production.product_type == ptype,
                            Production.logged_at > prev.counted_at,
                            Production.logged_at <= curr.counted_at,
                        )
                        .scalar()
                    )
                    consumed = prev.count + prod_between - curr.count
                    if consumed >= 0:
                        total_consumed += consumed
                        count_pairs += 1
                if count_pairs > 0:
                    avg_consumption = round(total_consumed / count_pairs, 2)

            estimated = round(max(0, last_count + produced - avg_consumption), 2)

            defaults.append(
                {
                    "flavor_id": flavor.id,
                    "flavor_name": flavor.name,
                    "category": flavor.category,
                    "product_type": ptype,
                    "estimated_count": estimated,
                    "last_count": last_count,
                    "produced_since": produced,
                    "avg_daily_consumption": avg_consumption,
                }
            )

    return defaults


@router.get("/history")
def count_history(days: int = 7, db: Session = Depends(get_db)):
    since = datetime.utcnow() - timedelta(days=days)
    rows = (
        db.query(DailyCount, Flavor.name)
        .join(Flavor, DailyCount.flavor_id == Flavor.id)
        .filter(DailyCount.counted_at >= since)
        .order_by(desc(DailyCount.counted_at))
        .all()
    )
    return [
        {
            "id": c.id,
            "flavor_id": c.flavor_id,
            "flavor_name": name,
            "product_type": c.product_type,
            "count": c.count,
            "counted_at": c.counted_at.isoformat() if c.counted_at else None,
        }
        for c, name in rows
    ]
