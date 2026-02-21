"""Seed the database with real flavors and sample data for demo."""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from datetime import datetime, timedelta
import random
from database import engine, SessionLocal, init_db, Base
from models import Flavor, Production, DailyCount, ParLevel

# Wipe and recreate
Base.metadata.drop_all(bind=engine)
init_db()

db = SessionLocal()

# ===== FLAVORS (from actual inventory sheets) =====
FLAVORS = [
    # Classics
    ("Sweet Cream", "Classics"),
    ("Vanilla", "Classics"),
    ("Chocolate", "Classics"),
    ("Strawberry", "Classics"),
    ("Coffee", "Classics"),
    # Fruity
    ("Banana Marshmallow", "Fruity"),
    ("Black Raspberry", "Fruity"),
    ("Black Cherry", "Fruity"),
    ("Creamcicle", "Fruity"),
    ("Peaches n Cream", "Fruity"),
    ("Razzmanian Devil", "Fruity"),
    # Chocolate
    ("Chocolate PB Swirl", "Chocolate"),
    ("Rocky Road", "Chocolate"),
    ("German Choc Brownie", "Chocolate"),
    ("Chocolate Chip", "Chocolate"),
    ("Mint Chip", "Chocolate"),
    # Nutty
    ("Toasted Almond", "Nutty"),
    ("PB Cup", "Nutty"),
    ("Butter Pecan", "Nutty"),
    # Cookie & Fun
    ("Funfetti", "Cookie & Fun"),
    ("Cookie Monster", "Cookie & Fun"),
    ("Cookies n Cream", "Cookie & Fun"),
    ("Cookie Dough", "Cookie & Fun"),
    # Sweet & Fun
    ("Caramel Swirl", "Sweet & Fun"),
    # Specialty
    ("Horchata", "Specialty"),
]

flavor_objs = []
for name, cat in FLAVORS:
    f = Flavor(name=name, category=cat, active=True)
    db.add(f)
    flavor_objs.append(f)

db.flush()  # assign IDs

print(f"Seeded {len(flavor_objs)} flavors")

# ===== SAMPLE DATA: 5 days of production + counts =====
# Simulate a week: Feb 7-11

# Popularity tiers (higher = more produced/sold)
HIGH = ["Vanilla", "Chocolate", "Strawberry", "Cookie Dough", "Cookies n Cream", "Mint Chip"]
MED = ["Sweet Cream", "Coffee", "Chocolate Chip", "PB Cup", "Rocky Road", "Chocolate PB Swirl",
       "Caramel Swirl", "Black Cherry", "Cookie Monster", "German Choc Brownie"]
LOW = ["Banana Marshmallow", "Horchata", "Black Raspberry", "Creamcicle", "Peaches n Cream",
       "Razzmanian Devil", "Toasted Almond", "Butter Pecan", "Funfetti"]

def tier(name):
    if name in HIGH:
        return "high"
    if name in MED:
        return "med"
    return "low"

# Product types each flavor is tracked in
# All flavors get tubs; most get pints & quarts too
# (Sweet Cream, Creamcicle, Peaches n Cream, Funfetti are tub-only per the sheets)
TUB_ONLY = {"Sweet Cream", "Creamcicle", "Peaches n Cream", "Funfetti"}

now = datetime.utcnow()
base_date = now.replace(hour=21, minute=0, second=0, microsecond=0) - timedelta(days=5)

production_count = 0
count_count = 0

for day_offset in range(5):
    day = base_date + timedelta(days=day_offset)
    prod_time = day.replace(hour=8 + random.randint(0, 2))
    count_time = day.replace(hour=21, minute=random.randint(0, 30))

    for f in flavor_objs:
        t = tier(f.name)
        ptypes = ["tub"]
        if f.name not in TUB_ONLY:
            ptypes += ["pint", "quart"]

        for ptype in ptypes:
            # Production: not every flavor every day
            if ptype == "tub":
                if t == "high":
                    make = random.choice([2, 3, 3, 4])
                elif t == "med":
                    make = random.choice([0, 1, 2, 2])
                else:
                    make = random.choice([0, 0, 1, 1])
            elif ptype == "pint":
                if t == "high":
                    make = random.choice([6, 8, 10, 12])
                elif t == "med":
                    make = random.choice([0, 4, 6, 6])
                else:
                    make = random.choice([0, 0, 2, 4])
            else:  # quart
                if t == "high":
                    make = random.choice([3, 4, 5, 6])
                elif t == "med":
                    make = random.choice([0, 2, 3, 3])
                else:
                    make = random.choice([0, 0, 1, 2])

            if make > 0:
                db.add(Production(
                    flavor_id=f.id,
                    product_type=ptype,
                    quantity=make,
                    logged_at=prod_time + timedelta(minutes=random.randint(0, 60)),
                ))
                production_count += 1

            # Daily count: simulate end-of-day remaining
            # Tubs can be partial (scooped throughout the day)
            if ptype == "tub":
                if t == "high":
                    remaining = random.choice([0.5, 1, 1.25, 1.5, 2, 2.75, 3])
                elif t == "med":
                    remaining = random.choice([1, 1.5, 2, 2.25, 2.5, 3, 3])
                else:
                    remaining = random.choice([2, 2.5, 3, 3.25, 3.5, 3.75, 4])
            elif ptype == "pint":
                if t == "high":
                    remaining = random.choice([2, 4, 5, 6])
                elif t == "med":
                    remaining = random.choice([3, 5, 6, 8])
                else:
                    remaining = random.choice([4, 6, 8, 10])
            else:  # quart
                if t == "high":
                    remaining = random.choice([1, 2, 3, 4])
                elif t == "med":
                    remaining = random.choice([2, 3, 4, 5])
                else:
                    remaining = random.choice([3, 4, 5, 6])

            db.add(DailyCount(
                flavor_id=f.id,
                product_type=ptype,
                count=remaining,
                counted_at=count_time + timedelta(minutes=random.randint(0, 15)),
            ))
            count_count += 1

db.commit()

# ===== PAR LEVELS (sensible defaults based on popularity tiers) =====
par_count = 0
for f in flavor_objs:
    t = tier(f.name)
    ptypes = ["tub"]
    if f.name not in TUB_ONLY:
        ptypes += ["pint", "quart"]

    for ptype in ptypes:
        if ptype == "tub":
            if t == "high":
                target, minimum, batch, subseq, wknd = 4, 2, 2.5, 2, 6
            elif t == "med":
                target, minimum, batch, subseq, wknd = 3, 1, 2.5, 2, 4
            else:
                target, minimum, batch, subseq, wknd = 2, 1, 2.5, 2, 3
        elif ptype == "pint":
            if t == "high":
                target, minimum, batch, subseq, wknd = 10, 4, 6, 5, 14
            elif t == "med":
                target, minimum, batch, subseq, wknd = 6, 2, 6, 5, 8
            else:
                target, minimum, batch, subseq, wknd = 4, 1, 4, 3, 6
        else:  # quart
            if t == "high":
                target, minimum, batch, subseq, wknd = 6, 2, 3, 2.5, 8
            elif t == "med":
                target, minimum, batch, subseq, wknd = 4, 1, 3, 2.5, 5
            else:
                target, minimum, batch, subseq, wknd = 2, 1, 2, 1.5, 3

        db.add(ParLevel(
            flavor_id=f.id,
            product_type=ptype,
            target=target,
            minimum=minimum,
            batch_size=batch,
            subsequent_batch_size=subseq,
            weekend_target=wknd,
        ))
        par_count += 1

db.commit()
db.close()

print(f"Seeded {production_count} production entries")
print(f"Seeded {count_count} daily count entries")
print(f"Seeded {par_count} par level entries")
print("Done! Database ready at inventory.db")
