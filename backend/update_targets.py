"""Update all par level targets to 8."""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal
from models import ParLevel

db = SessionLocal()

# Update all par levels to target = 8
updated = db.query(ParLevel).update({'target': 8})

db.commit()
db.close()

print(f'Updated {updated} par level targets to 8 (Ready at open)')
