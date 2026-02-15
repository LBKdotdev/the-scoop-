from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timedelta, date
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


@router.get("/variance")
def variance_report(days: int = Query(1, ge=1, le=90), db: Session = Depends(get_db)):
    """Variance tracking report: shows discrepancies between predicted and actual counts."""
    since = datetime.utcnow() - timedelta(days=days)

    # Get all counts with variance data
    counts = (
        db.query(DailyCount, Flavor.name, Flavor.category)
        .join(Flavor, DailyCount.flavor_id == Flavor.id)
        .filter(
            DailyCount.counted_at >= since,
            DailyCount.predicted_count.isnot(None),
            Flavor.active == True
        )
        .order_by(desc(DailyCount.counted_at))
        .all()
    )

    # Build response data
    all_items = []
    high_variance_items = []
    variance_by_date = {}

    for count, flavor_name, category in counts:
        count_date = count.counted_at.date().isoformat()

        item = {
            "id": count.id,
            "flavor_id": count.flavor_id,
            "flavor_name": flavor_name,
            "category": category,
            "product_type": count.product_type,
            "predicted": count.predicted_count,
            "actual": count.count,
            "variance": count.variance,
            "variance_pct": count.variance_pct,
            "counted_at": count.counted_at.isoformat(),
            "date": count_date,
            "employee_name": count.employee_name,
        }

        all_items.append(item)

        # Track high variance items (>25%)
        if count.variance_pct is not None and abs(count.variance_pct) > 25:
            high_variance_items.append(item)

        # Aggregate variance by date for trend
        if count_date not in variance_by_date:
            variance_by_date[count_date] = {
                "date": count_date,
                "total_items": 0,
                "high_variance_count": 0,
                "avg_variance_pct": []
            }
        variance_by_date[count_date]["total_items"] += 1
        if count.variance_pct is not None:
            variance_by_date[count_date]["avg_variance_pct"].append(abs(count.variance_pct))
            if abs(count.variance_pct) > 25:
                variance_by_date[count_date]["high_variance_count"] += 1

    # Calculate summary stats
    total_items = len(all_items)
    high_variance_count = len(high_variance_items)
    avg_variance = 0
    if all_items:
        valid_variances = [abs(item["variance_pct"]) for item in all_items if item["variance_pct"] is not None]
        avg_variance = round(sum(valid_variances) / len(valid_variances), 1) if valid_variances else 0

    # Build trend data
    trend_data = []
    for date_key in sorted(variance_by_date.keys()):
        data = variance_by_date[date_key]
        avg_pct = sum(data["avg_variance_pct"]) / len(data["avg_variance_pct"]) if data["avg_variance_pct"] else 0
        trend_data.append({
            "date": data["date"],
            "total_items": data["total_items"],
            "high_variance_count": data["high_variance_count"],
            "avg_variance_pct": round(avg_pct, 1)
        })

    # Sort high variance items by absolute variance percentage
    high_variance_items.sort(key=lambda x: abs(x["variance_pct"]) if x["variance_pct"] else 0, reverse=True)

    return {
        "summary": {
            "total_items": total_items,
            "high_variance_count": high_variance_count,
            "avg_variance_pct": avg_variance,
            "days": days,
        },
        "high_variance_items": high_variance_items[:20],  # Top 20
        "trend_data": trend_data,
        "all_items": all_items,
    }


@router.get("/variance/flavor/{flavor_id}")
def variance_by_flavor(flavor_id: int, days: int = Query(30, ge=1, le=90), db: Session = Depends(get_db)):
    """Get variance history for a specific flavor across all product types."""
    since = datetime.utcnow() - timedelta(days=days)

    # Get flavor info
    flavor = db.query(Flavor).filter(Flavor.id == flavor_id).first()
    if not flavor:
        return {"error": "Flavor not found"}

    # Get variance data for this flavor
    counts = (
        db.query(DailyCount)
        .filter(
            DailyCount.flavor_id == flavor_id,
            DailyCount.counted_at >= since,
            DailyCount.predicted_count.isnot(None)
        )
        .order_by(desc(DailyCount.counted_at))
        .all()
    )

    items = []
    for count in counts:
        items.append({
            "id": count.id,
            "product_type": count.product_type,
            "predicted": count.predicted_count,
            "actual": count.count,
            "variance": count.variance,
            "variance_pct": count.variance_pct,
            "counted_at": count.counted_at.isoformat(),
            "date": count.counted_at.date().isoformat(),
        })

    return {
        "flavor_id": flavor_id,
        "flavor_name": flavor.name,
        "category": flavor.category,
        "items": items,
        "days": days,
    }


@router.get("/employee-performance")
def employee_performance(days: int = Query(30, ge=1, le=90), db: Session = Depends(get_db)):
    """Employee performance analytics: accuracy, activity, and variance trends."""
    since = datetime.utcnow() - timedelta(days=days)

    # Get all counts with employee names
    counts = (
        db.query(DailyCount)
        .filter(
            DailyCount.counted_at >= since,
            DailyCount.employee_name.isnot(None),
            DailyCount.predicted_count.isnot(None)
        )
        .all()
    )

    # Get all production with employee names
    production = (
        db.query(Production)
        .filter(
            Production.logged_at >= since,
            Production.employee_name.isnot(None)
        )
        .all()
    )

    # Aggregate by employee
    employee_stats = {}

    # Process counts
    for count in counts:
        emp = count.employee_name
        if emp not in employee_stats:
            employee_stats[emp] = {
                "employee_name": emp,
                "total_counts": 0,
                "total_production": 0,
                "variances": [],
                "variance_sum": 0,
                "high_variance_count": 0,
                "last_activity": count.counted_at,
            }

        employee_stats[emp]["total_counts"] += 1
        if count.variance_pct is not None:
            employee_stats[emp]["variances"].append(abs(count.variance_pct))
            employee_stats[emp]["variance_sum"] += abs(count.variance_pct)
            if abs(count.variance_pct) > 25:
                employee_stats[emp]["high_variance_count"] += 1

        if count.counted_at > employee_stats[emp]["last_activity"]:
            employee_stats[emp]["last_activity"] = count.counted_at

    # Process production
    for prod in production:
        emp = prod.employee_name
        if emp not in employee_stats:
            employee_stats[emp] = {
                "employee_name": emp,
                "total_counts": 0,
                "total_production": 0,
                "variances": [],
                "variance_sum": 0,
                "high_variance_count": 0,
                "last_activity": prod.logged_at,
            }

        employee_stats[emp]["total_production"] += 1
        if prod.logged_at > employee_stats[emp]["last_activity"]:
            employee_stats[emp]["last_activity"] = prod.logged_at

    # Calculate metrics
    result = []
    for emp, stats in employee_stats.items():
        avg_variance = 0
        if stats["variances"]:
            avg_variance = round(stats["variance_sum"] / len(stats["variances"]), 1)

        # Accuracy score: 100 - avg_variance (higher is better)
        accuracy_score = max(0, round(100 - avg_variance, 1))

        # Reliability score based on consistency
        reliability = "High"
        if stats["high_variance_count"] > len(stats["variances"]) * 0.3:
            reliability = "Low"
        elif stats["high_variance_count"] > len(stats["variances"]) * 0.1:
            reliability = "Medium"

        result.append({
            "employee_name": emp,
            "total_counts": stats["total_counts"],
            "total_production": stats["total_production"],
            "total_activity": stats["total_counts"] + stats["total_production"],
            "avg_variance_pct": avg_variance,
            "accuracy_score": accuracy_score,
            "high_variance_count": stats["high_variance_count"],
            "reliability": reliability,
            "last_activity": stats["last_activity"].isoformat(),
        })

    # Sort by accuracy score (best first)
    result.sort(key=lambda x: x["accuracy_score"], reverse=True)

    return {
        "employees": result,
        "days": days,
        "total_employees": len(result),
    }
