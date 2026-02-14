"""Update all par levels with correct batch sizes."""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal
from models import ParLevel

db = SessionLocal()

# Update all par levels
pints_updated = db.query(ParLevel).filter(ParLevel.product_type == 'pint').update({'batch_size': 48})
quarts_updated = db.query(ParLevel).filter(ParLevel.product_type == 'quart').update({'batch_size': 24})
tubs_updated = db.query(ParLevel).filter(ParLevel.product_type == 'tub').update({'batch_size': 2.5})

db.commit()
db.close()

print(f"✓ Updated batch sizes:")
print(f"  - {pints_updated} pint records → 24 per batch")
print(f"  - {quarts_updated} quart records → 48 per batch")
print(f"  - {tubs_updated} tub records → 2.5 per batch")
