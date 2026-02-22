from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, and_
from collections import defaultdict
from datetime import datetime, timedelta
import math
from database import get_db
from models import Flavor, Production, DailyCount, ParLevel

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/inventory")
def current_inventory(db: Session = Depends(get_db)):
    """Current on-hand inventory per flavor per product type,
    based on last count + production since last count."""
    flavors = db.query(Flavor).filter(Flavor.status == 'active').order_by(Flavor.category, Flavor.name).all()
    if not flavors:
        return []

    flavor_ids = [f.id for f in flavors]

    # Bulk: latest count per (flavor_id, product_type) — 1 query
    max_time = (
        db.query(
            DailyCount.flavor_id,
            DailyCount.product_type,
            func.max(DailyCount.counted_at).label('max_at')
        )
        .filter(DailyCount.flavor_id.in_(flavor_ids))
        .group_by(DailyCount.flavor_id, DailyCount.product_type)
        .subquery()
    )
    latest_rows = (
        db.query(
            DailyCount.flavor_id, DailyCount.product_type,
            DailyCount.count, DailyCount.counted_at,
        )
        .join(max_time, and_(
            DailyCount.flavor_id == max_time.c.flavor_id,
            DailyCount.product_type == max_time.c.product_type,
            DailyCount.counted_at == max_time.c.max_at,
        ))
        .all()
    )
    count_map = {(r.flavor_id, r.product_type): (r.count, r.counted_at) for r in latest_rows}

    # Bulk: all production for active flavors, filter in Python — 1 query
    all_prod = (
        db.query(Production.flavor_id, Production.product_type, Production.quantity, Production.logged_at)
        .filter(Production.flavor_id.in_(flavor_ids))
        .all()
    )
    prod_map = {}
    for p in all_prod:
        key = (p.flavor_id, p.product_type)
        cutoff = count_map.get(key, (0, datetime.min))[1]
        if p.logged_at > cutoff:
            prod_map[key] = prod_map.get(key, 0) + p.quantity

    inventory = []
    for flavor in flavors:
        flavor_data = {
            "flavor_id": flavor.id,
            "name": flavor.name,
            "category": flavor.category,
            "products": {},
        }
        for ptype in ("tub", "pint", "quart"):
            key = (flavor.id, ptype)
            last_count = count_map.get(key, (0, None))[0]
            produced_since = prod_map.get(key, 0)
            flavor_data["products"][ptype] = {
                "on_hand": last_count + produced_since,
                "last_count": last_count,
                "produced_since": produced_since,
            }
        inventory.append(flavor_data)

    return inventory


@router.get("/make-list")
def morning_make_list(db: Session = Depends(get_db)):
    """Morning make list: what to produce based on par levels vs current on-hand."""
    inv = current_inventory(db=db)

    # Build on-hand lookup: (flavor_id, product_type) -> on_hand
    on_hand_map = {}
    for item in inv:
        for ptype in ("tub", "pint", "quart"):
            on_hand_map[(item["flavor_id"], ptype)] = item["products"][ptype]["on_hand"]

    # Check if today is a weekend (Fri=4, Sat=5, Sun=6)
    today = datetime.utcnow().weekday()
    is_weekend = today in (4, 5, 6)

    # Get all par levels for active flavors
    par_levels = (
        db.query(ParLevel, Flavor.name, Flavor.category)
        .join(Flavor, ParLevel.flavor_id == Flavor.id)
        .filter(Flavor.status == 'active')
        .all()
    )

    # Build per-flavor, per-type deficit info
    # Key: flavor_id -> { info + products: { tub/pint/quart: {...} } }
    flavor_map = {}
    for par, flavor_name, category in par_levels:
        on_hand = on_hand_map.get((par.flavor_id, par.product_type), 0)
        target = par.weekend_target if (is_weekend and par.weekend_target) else par.target

        if par.flavor_id not in flavor_map:
            flavor_map[par.flavor_id] = {
                "flavor_id": par.flavor_id,
                "flavor_name": flavor_name,
                "category": category,
                "is_weekend": is_weekend,
                "products": {},
            }

        if target <= 0:
            continue

        deficit = max(0, target - on_hand)
        batch = max(0.25, par.batch_size)
        subsequent = par.subsequent_batch_size

        # Stepping yield: first batch makes `batch`, subsequent batches make `subsequent`
        if deficit <= 0:
            batches_needed = 0
        elif subsequent and subsequent > 0:
            if deficit <= batch:
                batches_needed = 1
            else:
                batches_needed = 1 + math.ceil((deficit - batch) / subsequent)
        else:
            batches_needed = deficit / batch  # original flat behavior

        flavor_map[par.flavor_id]["products"][par.product_type] = {
            "on_hand": on_hand,
            "target": target,
            "minimum": par.minimum,
            "batch_size": par.batch_size,
            "subsequent_batch_size": subsequent,
            "deficit": deficit,
            "batches_needed": batches_needed,
            "status": "critical" if on_hand <= par.minimum and deficit > 0
                      else "below_par" if deficit > 0
                      else "stocked",
        }

    # Build final list: one row per flavor with combined batch count
    make_list = []
    for fid, fdata in flavor_map.items():
        products = fdata["products"]
        if not products:
            continue

        # Sum fractional batch needs across all product types, then round to nearest 0.5
        # (One batch can be split between tubs, pints, and quarts; half batches allowed)
        total_batch_need = 0.0
        for ptype in ["tub", "pint", "quart"]:
            p = products.get(ptype)
            if p and p["batches_needed"] > 0:
                total_batch_need += p["batches_needed"]
        # Round to nearest 0.5 batch (production can make half batches)
        total_batches = round(total_batch_need * 2) / 2 if total_batch_need > 0 else 0

        # Overall status: worst status across product types
        statuses = [p["status"] for p in products.values()]
        if "critical" in statuses:
            status = "critical"
        elif "below_par" in statuses:
            status = "below_par"
        else:
            status = "stocked"

        make_list.append({
            "flavor_id": fdata["flavor_id"],
            "flavor_name": fdata["flavor_name"],
            "category": fdata["category"],
            "is_weekend": fdata["is_weekend"],
            "products": products,
            "total_batches": total_batches,
            "status": status,
        })

    # Sort: critical first, then below_par, then stocked; within each by batches desc
    status_order = {"critical": 0, "below_par": 1, "stocked": 2}
    make_list.sort(key=lambda x: (
        status_order.get(x["status"], 9),
        -x["total_batches"],
    ))

    return make_list


@router.get("/consumption")
def daily_consumption(days: int = Query(7, ge=1, le=90), db: Session = Depends(get_db)):
    """Calculate daily consumption per flavor per product type.

    Consumed = previous_count + produced_between - current_count
    """
    since = datetime.utcnow() - timedelta(days=days)
    flavors = db.query(Flavor).filter(Flavor.active == True).all()
    if not flavors:
        return []

    flavor_ids = [f.id for f in flavors]
    flavor_names = {f.id: f.name for f in flavors}

    # Bulk: all counts since date — 1 query
    all_counts = (
        db.query(DailyCount)
        .filter(DailyCount.flavor_id.in_(flavor_ids), DailyCount.counted_at >= since)
        .order_by(DailyCount.flavor_id, DailyCount.product_type, DailyCount.counted_at)
        .all()
    )
    counts_by_key = defaultdict(list)
    for c in all_counts:
        counts_by_key[(c.flavor_id, c.product_type)].append(c)

    # Bulk: all production since date — 1 query
    all_prod = (
        db.query(Production.flavor_id, Production.product_type, Production.quantity, Production.logged_at)
        .filter(Production.flavor_id.in_(flavor_ids), Production.logged_at >= since)
        .all()
    )
    prod_by_key = defaultdict(list)
    for p in all_prod:
        prod_by_key[(p.flavor_id, p.product_type)].append(p)

    consumption_data = []
    for (fid, ptype), counts in counts_by_key.items():
        prods = prod_by_key.get((fid, ptype), [])
        for i in range(1, len(counts)):
            prev = counts[i - 1]
            curr = counts[i]
            prod_between = sum(
                p.quantity for p in prods
                if prev.counted_at < p.logged_at <= curr.counted_at
            )
            consumed = prev.count + prod_between - curr.count
            consumption_data.append({
                "flavor_id": fid,
                "flavor_name": flavor_names.get(fid, "Unknown"),
                "product_type": ptype,
                "consumed": max(0, consumed),
                "date": curr.counted_at.strftime("%Y-%m-%d") if curr.counted_at else None,
            })

    return consumption_data


@router.get("/popularity")
def flavor_popularity(days: int = Query(7, ge=1, le=90), db: Session = Depends(get_db)):
    """Rank flavors by total consumption over the period."""
    data = daily_consumption(days=days, db=db)
    totals = {}
    for row in data:
        key = row["flavor_name"]
        if key not in totals:
            totals[key] = {"flavor_name": key, "flavor_id": row["flavor_id"], "total": 0, "by_type": {}}
        totals[key]["total"] += row["consumed"]
        ptype = row["product_type"]
        totals[key]["by_type"][ptype] = totals[key]["by_type"].get(ptype, 0) + row["consumed"]

    ranked = sorted(totals.values(), key=lambda x: x["total"], reverse=True)
    return ranked


@router.get("/alerts")
def low_stock_alerts(db: Session = Depends(get_db)):
    """Generate alerts based on par levels (if set) with consumption-based fallback."""
    inv = current_inventory(db=db)

    # Build par level lookup
    par_rows = db.query(ParLevel).all()
    par_map = {}
    for p in par_rows:
        par_map[(p.flavor_id, p.product_type)] = p

    # Check weekend
    today = datetime.utcnow().weekday()
    is_weekend = today in (4, 5, 6)

    # Consumption-based fallback data
    consumption = daily_consumption(days=7, db=db)
    avg_consumption = {}
    count_map = {}
    for row in consumption:
        key = (row["flavor_id"], row["product_type"])
        avg_consumption[key] = avg_consumption.get(key, 0) + row["consumed"]
        count_map[key] = count_map.get(key, 0) + 1
    for key in avg_consumption:
        if count_map[key] > 0:
            avg_consumption[key] = round(avg_consumption[key] / count_map[key], 1)

    alerts = []
    for item in inv:
        for ptype in ("tub", "pint", "quart"):
            on_hand = item["products"][ptype]["on_hand"]
            key = (item["flavor_id"], ptype)
            par = par_map.get(key)

            if par and par.target > 0:
                # Par-level based alerts
                target = par.weekend_target if (is_weekend and par.weekend_target) else par.target
                avg = avg_consumption.get(key, 0)

                if on_hand <= par.minimum:
                    alerts.append({
                        "flavor_name": item["name"],
                        "flavor_id": item["flavor_id"],
                        "product_type": ptype,
                        "on_hand": on_hand,
                        "target": target,
                        "minimum": par.minimum,
                        "avg_daily": avg,
                        "urgency": "critical",
                        "message": f"MAKE NOW - only {on_hand} left (minimum is {par.minimum})",
                    })
                elif on_hand < target:
                    deficit = target - on_hand
                    alerts.append({
                        "flavor_name": item["name"],
                        "flavor_id": item["flavor_id"],
                        "product_type": ptype,
                        "on_hand": on_hand,
                        "target": target,
                        "minimum": par.minimum,
                        "avg_daily": avg,
                        "urgency": "warning",
                        "message": f"Below target - have {on_hand}, want {target} (need {deficit} more)",
                    })
                elif target > 0 and on_hand > target * 1.5:
                    alerts.append({
                        "flavor_name": item["name"],
                        "flavor_id": item["flavor_id"],
                        "product_type": ptype,
                        "on_hand": on_hand,
                        "target": target,
                        "minimum": par.minimum,
                        "avg_daily": avg,
                        "urgency": "overstocked",
                        "message": f"Overstocked - have {on_hand}, target is {target} (waste risk)",
                    })
            else:
                # Fallback: consumption-based alerts (original logic)
                avg = avg_consumption.get(key, 0)
                if avg > 0:
                    days_left = round(on_hand / avg, 1)
                elif on_hand == 0:
                    days_left = 0
                else:
                    continue

                if days_left <= 1:
                    urgency = "critical"
                elif days_left <= 2:
                    urgency = "warning"
                elif days_left <= 3:
                    urgency = "low"
                else:
                    continue

                alerts.append({
                    "flavor_name": item["name"],
                    "flavor_id": item["flavor_id"],
                    "product_type": ptype,
                    "on_hand": on_hand,
                    "avg_daily": avg,
                    "days_left": days_left,
                    "urgency": urgency,
                    "message": f"{on_hand} left · avg {avg}/day · ~{days_left} days",
                })

    # Sort: critical first, then warning, then low/overstocked
    urgency_order = {"critical": 0, "warning": 1, "low": 2, "overstocked": 3}
    alerts.sort(key=lambda x: urgency_order.get(x["urgency"], 9))
    return alerts


@router.get("/production-vs-consumption")
def production_vs_consumption(days: int = Query(7, ge=1, le=90), db: Session = Depends(get_db)):
    """Compare total production to total consumption per flavor."""
    since = datetime.utcnow() - timedelta(days=days)

    # Total production per flavor
    prod_rows = (
        db.query(
            Flavor.name,
            Production.product_type,
            func.sum(Production.quantity).label("total_produced"),
        )
        .join(Flavor, Production.flavor_id == Flavor.id)
        .filter(Production.logged_at >= since)
        .group_by(Flavor.name, Production.product_type)
        .all()
    )

    production_map = {}
    for name, ptype, total in prod_rows:
        production_map[(name, ptype)] = total

    # Total consumption
    consumption = daily_consumption(days=days, db=db)
    consumption_map = {}
    for row in consumption:
        key = (row["flavor_name"], row["product_type"])
        consumption_map[key] = consumption_map.get(key, 0) + row["consumed"]

    all_keys = set(production_map.keys()) | set(consumption_map.keys())
    result = []
    for name, ptype in sorted(all_keys):
        produced = production_map.get((name, ptype), 0)
        consumed = consumption_map.get((name, ptype), 0)
        result.append(
            {
                "flavor_name": name,
                "product_type": ptype,
                "produced": produced,
                "consumed": consumed,
                "difference": produced - consumed,
            }
        )

    return result
