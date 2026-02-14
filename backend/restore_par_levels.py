"""Restore par levels from seed logic."""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal
from models import Flavor, ParLevel

db = SessionLocal()

# Popularity tiers from seed
HIGH = ["Vanilla", "Chocolate", "Strawberry", "Cookie Dough", "Cookies n Cream", "Mint Chip"]
MED = ["Sweet Cream", "Coffee", "Chocolate Chip", "PB Cup", "Rocky Road", "Chocolate PB Swirl",
       "Caramel Swirl", "Black Cherry", "Cookie Monster", "German Choc Brownie"]
LOW = ["Banana Marshmallow", "Horchata", "Black Raspberry", "Creamcicle", "Peaches n Cream",
       "Razzmanian Devil", "Toasted Almond", "Butter Pecan", "Funfetti"]

def tier(name):
    if name in HIGH: return "high"
    if name in MED: return "med"
    return "low"

TUB_ONLY = {"Sweet Cream", "Creamcicle", "Peaches n Cream", "Funfetti"}

flavors = db.query(Flavor).all()
count = 0

for f in flavors:
    t = tier(f.name)
    ptypes = ["tub"]
    if f.name not in TUB_ONLY:
        ptypes += ["pint", "quart"]

    for ptype in ptypes:
        if ptype == "tub":
            if t == "high":
                target, minimum, batch, wknd = 4, 2, 2.5, 6
            elif t == "med":
                target, minimum, batch, wknd = 3, 1, 2.5, 4
            else:
                target, minimum, batch, wknd = 2, 1, 2.5, 3
        elif ptype == "pint":
            if t == "high":
                target, minimum, batch, wknd = 10, 4, 6, 14
            elif t == "med":
                target, minimum, batch, wknd = 6, 2, 6, 8
            else:
                target, minimum, batch, wknd = 4, 1, 4, 6
        else:  # quart
            if t == "high":
                target, minimum, batch, wknd = 6, 2, 3, 8
            elif t == "med":
                target, minimum, batch, wknd = 4, 1, 3, 5
            else:
                target, minimum, batch, wknd = 2, 1, 2, 3

        db.add(ParLevel(
            flavor_id=f.id,
            product_type=ptype,
            target=target,
            minimum=minimum,
            batch_size=batch,
            weekend_target=wknd,
        ))
        count += 1

db.commit()
db.close()

print(f"Restored {count} par level records")
print("These are the original seed values - you can now adjust them in the Flavors tab")
