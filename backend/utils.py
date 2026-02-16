"""Helper utilities for auto-discontinuation logic."""

from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import datetime
from models import DailyCount


def is_specialty_category(category: str) -> bool:
    """Check if a flavor category is considered specialty/seasonal.

    Args:
        category: The flavor category string

    Returns:
        True if the category is specialty/seasonal, False otherwise
    """
    if not category:
        return False
    return category.lower() in ['specialty', 'seasonal', 'specials']


def update_last_counted_cache(db: Session, flavor_id: int) -> datetime:
    """Update the last_counted_at field for a flavor based on most recent DailyCount.

    This should be called after count submission to keep the cache fresh.

    Args:
        db: Database session
        flavor_id: The flavor ID to update

    Returns:
        The last counted datetime, or None if no counts exist
    """
    from models import Flavor

    # Get the most recent count for this flavor
    last_count = (
        db.query(DailyCount.counted_at)
        .filter(DailyCount.flavor_id == flavor_id)
        .order_by(desc(DailyCount.counted_at))
        .first()
    )

    # Update the flavor's cache
    flavor = db.query(Flavor).filter(Flavor.id == flavor_id).first()
    if flavor and last_count:
        flavor.last_counted_at = last_count[0]
        db.commit()
        return last_count[0]

    return None
