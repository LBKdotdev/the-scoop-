from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from database import get_db
from models import Flavor, ParLevel
from auto_discontinue import get_at_risk_flavors, auto_discontinue_specialties

router = APIRouter(prefix="/api/flavors", tags=["flavors"])


class FlavorCreate(BaseModel):
    name: str
    category: str = "classics"


class FlavorUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    active: Optional[bool] = None


class ParLevelUpdate(BaseModel):
    target: int = 0
    minimum: int = 0
    batch_size: float = 1
    subsequent_batch_size: Optional[float] = None
    weekend_target: Optional[int] = None


class ParLevelBulkItem(BaseModel):
    flavor_id: int
    product_type: str
    target: int = 0
    minimum: int = 0
    batch_size: float = 1
    subsequent_batch_size: Optional[float] = None
    weekend_target: Optional[int] = None


class ParLevelBulkUpdate(BaseModel):
    levels: List[ParLevelBulkItem]


@router.get("")
def list_flavors(
    active_only: bool = True,
    include_discontinued: bool = False,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """List flavors with optional filtering.

    Args:
        active_only: Legacy filter (uses status field internally)
        include_discontinued: Include discontinued flavors in results
        status_filter: Filter by specific status ("active", "discontinued", "archived")
    """
    query = db.query(Flavor)

    # Handle status filtering
    if status_filter:
        query = query.filter(Flavor.status == status_filter)
    elif active_only and not include_discontinued:
        query = query.filter(Flavor.status == 'active')
    elif include_discontinued:
        query = query.filter(Flavor.status.in_(['active', 'discontinued']))

    return query.order_by(Flavor.category, Flavor.name).all()


@router.post("", status_code=201)
def create_flavor(flavor: FlavorCreate, db: Session = Depends(get_db)):
    existing = db.query(Flavor).filter(Flavor.name == flavor.name).first()
    if existing:
        raise HTTPException(400, "Flavor already exists")
    db_flavor = Flavor(name=flavor.name, category=flavor.category)
    db.add(db_flavor)
    db.flush()  # assign ID

    # Auto-create default par levels for all product types
    for ptype in ("tub", "pint", "quart"):
        db.add(ParLevel(
            flavor_id=db_flavor.id,
            product_type=ptype,
            target=0,
            minimum=0,
            batch_size=2.5 if ptype == "tub" else (48 if ptype == "pint" else 24),
            subsequent_batch_size=2 if ptype == "tub" else (40 if ptype == "pint" else 20),
        ))

    db.commit()
    db.refresh(db_flavor)
    return db_flavor


# ===== PAR LEVELS (before parameterized routes to avoid conflicts) =====

@router.get("/par-levels")
def get_all_par_levels(db: Session = Depends(get_db)):
    """Get par levels for all active flavors."""
    levels = (
        db.query(ParLevel, Flavor.name, Flavor.category)
        .join(Flavor, ParLevel.flavor_id == Flavor.id)
        .filter(Flavor.active == True)
        .order_by(Flavor.category, Flavor.name)
        .all()
    )
    return [
        {
            "id": pl.id,
            "flavor_id": pl.flavor_id,
            "flavor_name": name,
            "category": cat,
            "product_type": pl.product_type,
            "target": pl.target,
            "minimum": pl.minimum,
            "batch_size": pl.batch_size,
            "subsequent_batch_size": pl.subsequent_batch_size,
            "weekend_target": pl.weekend_target,
        }
        for pl, name, cat in levels
    ]


@router.put("/par-levels/bulk")
def bulk_update_par_levels(data: ParLevelBulkUpdate, db: Session = Depends(get_db)):
    """Bulk update par levels."""
    updated = 0
    for item in data.levels:
        if item.product_type not in ("tub", "pint", "quart"):
            continue
        par = (
            db.query(ParLevel)
            .filter(ParLevel.flavor_id == item.flavor_id, ParLevel.product_type == item.product_type)
            .first()
        )
        if not par:
            par = ParLevel(flavor_id=item.flavor_id, product_type=item.product_type)
            db.add(par)

        par.target = item.target
        par.minimum = item.minimum
        par.batch_size = max(0.25, item.batch_size)
        par.subsequent_batch_size = item.subsequent_batch_size
        par.weekend_target = item.weekend_target
        updated += 1

    db.commit()
    return {"updated": updated}


# ===== AUTO-DISCONTINUATION ENDPOINTS (before parameterized routes) =====

@router.get("/at-risk")
def get_at_risk(db: Session = Depends(get_db)):
    """Get specialty flavors at risk of auto-discontinuation."""
    return get_at_risk_flavors(db)


@router.post("/admin/auto-discontinue")
def run_auto_discontinue(db: Session = Depends(get_db)):
    """Manually trigger auto-discontinuation check (admin only)."""
    result = auto_discontinue_specialties(db)
    return result


# ===== FLAVOR CRUD (parameterized routes) =====

@router.put("/{flavor_id}")
def update_flavor(flavor_id: int, update: FlavorUpdate, db: Session = Depends(get_db)):
    flavor = db.query(Flavor).filter(Flavor.id == flavor_id).first()
    if not flavor:
        raise HTTPException(404, "Flavor not found")
    if update.name is not None:
        flavor.name = update.name
    if update.category is not None:
        flavor.category = update.category
    if update.active is not None:
        flavor.active = update.active
    db.commit()
    db.refresh(flavor)
    return flavor


@router.delete("/{flavor_id}")
def archive_flavor(flavor_id: int, db: Session = Depends(get_db)):
    flavor = db.query(Flavor).filter(Flavor.id == flavor_id).first()
    if not flavor:
        raise HTTPException(404, "Flavor not found")
    flavor.active = False
    flavor.status = 'archived'
    db.commit()
    return {"message": f"'{flavor.name}' archived"}


@router.put("/{flavor_id}/discontinue")
def discontinue_flavor(flavor_id: int, db: Session = Depends(get_db)):
    """Manually mark a flavor as discontinued (typically for sold-out specialties)."""
    flavor = db.query(Flavor).filter(Flavor.id == flavor_id).first()
    if not flavor:
        raise HTTPException(404, "Flavor not found")
    if flavor.status == 'discontinued':
        return {"message": f"'{flavor.name}' is already discontinued"}

    flavor.status = 'discontinued'
    flavor.discontinued_at = datetime.utcnow()
    flavor.manually_discontinued = True
    flavor.active = False  # Backward compatibility
    db.commit()
    db.refresh(flavor)
    return {"message": f"'{flavor.name}' marked as discontinued", "flavor": flavor}


@router.put("/{flavor_id}/reactivate")
def reactivate_flavor(flavor_id: int, db: Session = Depends(get_db)):
    """Reactivate a discontinued flavor."""
    flavor = db.query(Flavor).filter(Flavor.id == flavor_id).first()
    if not flavor:
        raise HTTPException(404, "Flavor not found")
    if flavor.status == 'active':
        return {"message": f"'{flavor.name}' is already active"}

    flavor.status = 'active'
    flavor.discontinued_at = None
    flavor.manually_discontinued = False
    flavor.active = True  # Backward compatibility
    db.commit()
    db.refresh(flavor)
    return {"message": f"'{flavor.name}' reactivated", "flavor": flavor}


@router.put("/{flavor_id}/par-levels/{product_type}")
def set_par_level(
    flavor_id: int, product_type: str, data: ParLevelUpdate, db: Session = Depends(get_db)
):
    """Set par level for a specific flavor + product type."""
    flavor = db.query(Flavor).filter(Flavor.id == flavor_id).first()
    if not flavor:
        raise HTTPException(404, "Flavor not found")
    if product_type not in ("tub", "pint", "quart"):
        raise HTTPException(400, "Invalid product type")

    par = (
        db.query(ParLevel)
        .filter(ParLevel.flavor_id == flavor_id, ParLevel.product_type == product_type)
        .first()
    )
    if not par:
        par = ParLevel(flavor_id=flavor_id, product_type=product_type)
        db.add(par)

    par.target = data.target
    par.minimum = data.minimum
    par.batch_size = max(0.25, data.batch_size)
    par.subsequent_batch_size = data.subsequent_batch_size
    par.weekend_target = data.weekend_target
    db.commit()
    db.refresh(par)
    return par
