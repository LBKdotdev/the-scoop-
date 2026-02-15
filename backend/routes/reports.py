from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta
from database import get_db
from models import Flavor, Production, DailyCount, ParLevel
from routes.dashboard import daily_consumption

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/waste")
def waste_report(days: int = Query(7, ge=1, le=90), db: Session = Depends(get_db)):
    """Production summary: per-flavor production volumes and consumption patterns."""
    since = datetime.utcnow() - timedelta(days=days)

    # Total production per flavor (aggregated across product types)
    prod_rows = (
        db.query(Flavor.name, func.sum(Production.quantity).label("total"))
        .join(Flavor, Production.flavor_id == Flavor.id)
        .filter(Production.logged_at >= since, Flavor.active == True)
        .group_by(Flavor.name)
        .all()
    )
    production_map = {name: total for name, total in prod_rows}

    # Total consumption per flavor
    consumption = daily_consumption(days=days, db=db)
    consumption_map = {}
    for row in consumption:
        consumption_map[row["flavor_name"]] = (
            consumption_map.get(row["flavor_name"], 0) + row["consumed"]
        )

    all_flavors = set(production_map.keys()) | set(consumption_map.keys())
    result = []
    for name in sorted(all_flavors):
        produced = production_map.get(name, 0)
        consumed = consumption_map.get(name, 0)
        surplus = produced - consumed
        surplus_pct = round((surplus / produced) * 100, 1) if produced > 0 else 0
        result.append({
            "flavor_name": name,
            "produced": produced,
            "consumed": consumed,
            "surplus": surplus,
            "surplus_pct": surplus_pct,
        })

    # Sort by production volume descending
    result.sort(key=lambda x: x["produced"], reverse=True)
    return result


@router.get("/par-accuracy")
def par_accuracy(days: int = Query(7, ge=1, le=90), db: Session = Depends(get_db)):
    """Compare average daily consumption to par level targets and suggest adjustments."""
    consumption = daily_consumption(days=days, db=db)

    # Average daily consumption per flavor per product type
    totals = {}
    day_counts = {}
    for row in consumption:
        key = (row["flavor_id"], row["flavor_name"], row["product_type"])
        totals[key] = totals.get(key, 0) + row["consumed"]
        # Count unique dates for proper averaging
        date_key = (row["flavor_id"], row["product_type"], row["date"])
        if date_key not in day_counts:
            day_counts[date_key] = True

    date_count_per_key = {}
    for (fid, ptype, _date) in day_counts:
        k = (fid, ptype)
        date_count_per_key[k] = date_count_per_key.get(k, 0) + 1

    # Get par levels with flavor info
    par_rows = (
        db.query(ParLevel, Flavor.name, Flavor.category)
        .join(Flavor, ParLevel.flavor_id == Flavor.id)
        .filter(Flavor.active == True)
        .all()
    )

    result = []
    for par, flavor_name, category in par_rows:
        if par.target <= 0:
            continue

        key = (par.flavor_id, flavor_name, par.product_type)
        total_consumed = totals.get(key, 0)
        num_days = date_count_per_key.get((par.flavor_id, par.product_type), 0)
        avg_daily = round(total_consumed / num_days, 1) if num_days > 0 else 0

        # Suggest target = avg daily use * 1.2 (20% buffer), rounded up
        suggested = max(1, round(avg_daily * 1.2)) if avg_daily > 0 else par.target

        # Determine status
        if par.target > 0 and avg_daily > 0:
            ratio = par.target / avg_daily
            if ratio > 1.5:
                status = "too_high"
                action = f"Lower to {suggested}"
            elif ratio < 0.8:
                status = "too_low"
                action = f"Raise to {suggested}"
            else:
                status = "well_set"
                action = None
        else:
            status = "well_set"
            action = None

        result.append({
            "flavor_id": par.flavor_id,
            "flavor_name": flavor_name,
            "category": category,
            "product_type": par.product_type,
            "current_target": par.target,
            "avg_daily_use": avg_daily,
            "suggested_target": suggested,
            "status": status,
            "action": action,
        })

    # Sort: too_low first, then too_high, then well_set
    status_order = {"too_low": 0, "too_high": 1, "well_set": 2}
    result.sort(key=lambda x: status_order.get(x["status"], 9))
    return result
