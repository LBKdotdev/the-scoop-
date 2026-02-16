"""Auto-discontinuation script for specialty flavors.

Automatically marks specialty flavors as discontinued when they haven't been counted
in AUTO_DISCONTINUE_DAYS days.

Run this script:
- Daily via cron/scheduler
- Manually: python auto_discontinue.py
- Via API: POST /api/admin/auto-discontinue
"""

import sys
from datetime import datetime, timedelta
from sqlalchemy import and_, or_
from database import SessionLocal
from models import Flavor
from utils import is_specialty_category

# Configuration
AUTO_DISCONTINUE_DAYS = 21  # Days without counts before auto-discontinue
AT_RISK_WARNING_DAYS = 14   # Show warning when approaching auto-discontinuation


def auto_discontinue_specialties(db: SessionLocal = None):
    """Find and discontinue specialty flavors that haven't been counted recently.

    Returns:
        dict with counts of discontinued and at-risk flavors
    """
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        cutoff_date = datetime.utcnow() - timedelta(days=AUTO_DISCONTINUE_DAYS)

        # Find specialty flavors that should be auto-discontinued
        candidates = (
            db.query(Flavor)
            .filter(
                Flavor.status == 'active',
                Flavor.manually_discontinued == False,
                or_(
                    Flavor.last_counted_at == None,
                    Flavor.last_counted_at < cutoff_date
                )
            )
            .all()
        )

        # Filter to only specialty categories
        specialties_to_discontinue = [
            f for f in candidates
            if is_specialty_category(f.category)
        ]

        # Discontinue them
        discontinued_count = 0
        for flavor in specialties_to_discontinue:
            flavor.status = 'discontinued'
            flavor.discontinued_at = datetime.utcnow()
            discontinued_count += 1
            print(f"Auto-discontinued: {flavor.name} (last counted: {flavor.last_counted_at})")

        db.commit()

        return {
            "discontinued": discontinued_count,
            "timestamp": datetime.utcnow().isoformat()
        }

    except Exception as e:
        print(f"Error during auto-discontinuation: {e}")
        db.rollback()
        raise
    finally:
        if close_db:
            db.close()


def get_at_risk_flavors(db: SessionLocal = None):
    """Get specialty flavors approaching auto-discontinuation.

    Returns:
        List of flavors that haven't been counted in AT_RISK_WARNING_DAYS+ days
    """
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        warning_cutoff = datetime.utcnow() - timedelta(days=AT_RISK_WARNING_DAYS)
        discontinue_cutoff = datetime.utcnow() - timedelta(days=AUTO_DISCONTINUE_DAYS)

        # Find active specialty flavors between warning and discontinue threshold
        candidates = (
            db.query(Flavor)
            .filter(
                Flavor.status == 'active',
                or_(
                    Flavor.last_counted_at == None,
                    and_(
                        Flavor.last_counted_at < warning_cutoff,
                        Flavor.last_counted_at >= discontinue_cutoff
                    )
                )
            )
            .all()
        )

        # Filter to only specialty categories and calculate days
        at_risk = []
        for flavor in candidates:
            if is_specialty_category(flavor.category):
                if flavor.last_counted_at:
                    days_since = (datetime.utcnow() - flavor.last_counted_at).days
                else:
                    days_since = (datetime.utcnow() - flavor.created_at).days

                at_risk.append({
                    "id": flavor.id,
                    "name": flavor.name,
                    "category": flavor.category,
                    "last_counted_at": flavor.last_counted_at.isoformat() if flavor.last_counted_at else None,
                    "days_since_count": days_since,
                    "days_until_auto_discontinue": AUTO_DISCONTINUE_DAYS - days_since
                })

        return at_risk

    finally:
        if close_db:
            db.close()


if __name__ == "__main__":
    print(f"Running auto-discontinuation check (threshold: {AUTO_DISCONTINUE_DAYS} days)")
    result = auto_discontinue_specialties()
    print(f"\nResults:")
    print(f"  Discontinued: {result['discontinued']} flavors")
    print(f"  Timestamp: {result['timestamp']}")

    # Show at-risk flavors
    at_risk = get_at_risk_flavors()
    if at_risk:
        print(f"\n  At Risk ({len(at_risk)} flavors):")
        for flavor in at_risk:
            print(f"    - {flavor['name']}: {flavor['days_since_count']} days since last count")
