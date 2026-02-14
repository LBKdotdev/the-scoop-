"""Import real inventory counts from CSV files."""
import sys
import os
import csv
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal, Base, engine
from models import Flavor, DailyCount

# Wipe existing counts (keep flavors and par levels)
print("Clearing old count data...")
db = SessionLocal()
db.query(DailyCount).delete()
db.commit()

# Load tubs data
tubs_file = os.path.join(os.path.dirname(__file__), '..', 'real_counts_transcription.csv')
pints_quarts_file = os.path.join(os.path.dirname(__file__), '..', 'pints_quarts_transcription.csv')

# Get flavor ID mapping
flavors = db.query(Flavor).all()
flavor_map = {f.name: f.id for f in flavors}

count_records = []

# Read tubs
print(f"Reading {tubs_file}...")
with open(tubs_file, 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        flavor_name = row['flavor']
        if flavor_name not in flavor_map:
            print(f"  WARNING: Flavor '{flavor_name}' not found in database, skipping")
            continue

        count_records.append({
            'flavor_id': flavor_map[flavor_name],
            'product_type': row['product_type'],
            'date': row['date'],
            'count': float(row['count']) if row['count'] and row['count'] != '?' else 0,
        })

# Read pints & quarts
print(f"Reading {pints_quarts_file}...")
with open(pints_quarts_file, 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        flavor_name = row['flavor']
        if flavor_name not in flavor_map:
            print(f"  WARNING: Flavor '{flavor_name}' not found in database, skipping")
            continue

        count_records.append({
            'flavor_id': flavor_map[flavor_name],
            'product_type': row['product_type'],
            'date': row['date'],
            'count': float(row['count']) if row['count'] and row['count'] != '?' else 0,
        })

# Insert all counts
print(f"\nInserting {len(count_records)} count records...")
for rec in count_records:
    # Parse date and set time to 9 PM (21:00)
    date_obj = datetime.strptime(rec['date'], '%Y-%m-%d')
    counted_at = date_obj.replace(hour=21, minute=0, second=0)

    db.add(DailyCount(
        flavor_id=rec['flavor_id'],
        product_type=rec['product_type'],
        count=rec['count'],
        counted_at=counted_at,
    ))

db.commit()
db.close()

print(f"\n✓ Successfully imported {len(count_records)} real count records!")
print("Database now contains your actual inventory data from 2/9-2/12.")
