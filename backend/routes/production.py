from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from pydantic import BaseModel
from datetime import datetime, timedelta
from database import get_db
from models import Production, Flavor

router = APIRouter(prefix="/api/production", tags=["production"])


class ProductionCreate(BaseModel):
    flavor_id: int
    product_type: str  # tub, pint, quart
    quantity: int


@router.post("", status_code=201)
def log_production(entry: ProductionCreate, db: Session = Depends(get_db)):
    flavor = db.query(Flavor).filter(Flavor.id == entry.flavor_id).first()
    if not flavor:
        raise HTTPException(404, "Flavor not found")
    if entry.product_type not in ("tub", "pint", "quart"):
        raise HTTPException(400, "product_type must be tub, pint, or quart")
    if entry.quantity < 1:
        raise HTTPException(400, "Quantity must be at least 1")
    record = Production(
        flavor_id=entry.flavor_id,
        product_type=entry.product_type,
        quantity=entry.quantity,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.get("")
def list_production(
    days: int = Query(7, ge=1, le=90),
    db: Session = Depends(get_db),
):
    since = datetime.utcnow() - timedelta(days=days)
    rows = (
        db.query(Production, Flavor.name)
        .join(Flavor, Production.flavor_id == Flavor.id)
        .filter(Production.logged_at >= since)
        .order_by(desc(Production.logged_at))
        .all()
    )
    return [
        {
            "id": p.id,
            "flavor_id": p.flavor_id,
            "flavor_name": name,
            "product_type": p.product_type,
            "quantity": p.quantity,
            "logged_at": p.logged_at.isoformat() if p.logged_at else None,
        }
        for p, name in rows
    ]


@router.delete("/{entry_id}")
def delete_production(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(Production).filter(Production.id == entry_id).first()
    if not entry:
        raise HTTPException(404, "Production entry not found")
    db.delete(entry)
    db.commit()
    return {"message": "Deleted"}
