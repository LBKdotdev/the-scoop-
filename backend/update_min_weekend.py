"""Update minimum and weekend targets for all par levels."""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal
from models import ParLevel

db = SessionLocal()

# Update all par levels
updated = db.query(ParLevel).update({
    'minimum': 7,
    'weekend_target': 9
})

db.commit()
db.close()

print(f'Updated {updated} par levels:')
print('  - Minimum (Make more at): 7')
print('  - Weekend target: 9')
