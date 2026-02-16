"""Migration script to add auto-discontinuation fields to Flavor model.

Adds:
- status (String, default "active")
- discontinued_at (DateTime, nullable)
- last_counted_at (DateTime, nullable)
- manually_discontinued (Boolean, default False)
"""

import sys
from sqlalchemy import Column, String, DateTime, Boolean, text
from database import SessionLocal, engine


def column_exists(table_name, column_name):
    """Check if a column exists in the database."""
    with engine.connect() as conn:
        result = conn.execute(text(f"PRAGMA table_info({table_name})"))
        columns = [row[1] for row in result]
        return column_name in columns


def migrate():
    """Add new columns to flavors table if they don't exist."""
    db = SessionLocal()
    try:
        print("Starting migration: add flavor status fields")

        # Check and add status column
        if not column_exists("flavors", "status"):
            print("  Adding 'status' column...")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE flavors ADD COLUMN status VARCHAR DEFAULT 'active'"))
                conn.commit()
            print("  [OK] Added 'status' column")
        else:
            print("  [OK] 'status' column already exists")

        # Check and add discontinued_at column
        if not column_exists("flavors", "discontinued_at"):
            print("  Adding 'discontinued_at' column...")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE flavors ADD COLUMN discontinued_at DATETIME"))
                conn.commit()
            print("  [OK] Added 'discontinued_at' column")
        else:
            print("  [OK] 'discontinued_at' column already exists")

        # Check and add last_counted_at column
        if not column_exists("flavors", "last_counted_at"):
            print("  Adding 'last_counted_at' column...")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE flavors ADD COLUMN last_counted_at DATETIME"))
                conn.commit()
            print("  [OK] Added 'last_counted_at' column")
        else:
            print("  [OK] 'last_counted_at' column already exists")

        # Check and add manually_discontinued column
        if not column_exists("flavors", "manually_discontinued"):
            print("  Adding 'manually_discontinued' column...")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE flavors ADD COLUMN manually_discontinued BOOLEAN DEFAULT 0"))
                conn.commit()
            print("  [OK] Added 'manually_discontinued' column")
        else:
            print("  [OK] 'manually_discontinued' column already exists")

        # Populate last_counted_at from most recent DailyCount
        print("  Populating 'last_counted_at' from existing counts...")
        result = db.execute(text("""
            UPDATE flavors
            SET last_counted_at = (
                SELECT MAX(counted_at)
                FROM daily_counts
                WHERE daily_counts.flavor_id = flavors.id
            )
            WHERE EXISTS (
                SELECT 1 FROM daily_counts WHERE daily_counts.flavor_id = flavors.id
            )
        """))
        db.commit()
        print(f"  [OK] Updated last_counted_at for {result.rowcount} flavors")

        # Ensure all flavors have status='active' (backward compatibility)
        print("  Setting default status='active' for existing flavors...")
        result = db.execute(text("""
            UPDATE flavors
            SET status = 'active'
            WHERE status IS NULL OR status = ''
        """))
        db.commit()
        print(f"  [OK] Set status='active' for {result.rowcount} flavors")

        print("Migration completed successfully!")
        return True

    except Exception as e:
        print(f"Migration failed: {e}")
        db.rollback()
        return False
    finally:
        db.close()


if __name__ == "__main__":
    success = migrate()
    sys.exit(0 if success else 1)
