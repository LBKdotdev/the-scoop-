"""
Migration: Add variance tracking fields to DailyCount table

This script adds three new columns to the daily_counts table:
- predicted_count: stores the system's prediction
- variance: stores the difference (actual - predicted)
- variance_pct: stores the percentage variance
"""

import sqlite3
import os

# Get database path
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "inventory.db")

def migrate():
    print(f"Connecting to database: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Check if columns already exist
    cursor.execute("PRAGMA table_info(daily_counts)")
    columns = [row[1] for row in cursor.fetchall()]

    if 'predicted_count' in columns:
        print("[OK] Variance columns already exist. Migration not needed.")
        conn.close()
        return

    print("Adding variance tracking columns to daily_counts table...")

    try:
        # Add new columns
        cursor.execute("ALTER TABLE daily_counts ADD COLUMN predicted_count REAL")
        cursor.execute("ALTER TABLE daily_counts ADD COLUMN variance REAL")
        cursor.execute("ALTER TABLE daily_counts ADD COLUMN variance_pct REAL")

        conn.commit()
        print("[SUCCESS] Added variance tracking columns!")
        print("  - predicted_count (REAL)")
        print("  - variance (REAL)")
        print("  - variance_pct (REAL)")

    except sqlite3.Error as e:
        print(f"[ERROR] Migration failed: {e}")
        conn.rollback()
        raise

    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
