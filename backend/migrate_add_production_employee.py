"""
Migration: Add employee_name field to Production table

This script adds employee tracking to production logging.
"""

import sqlite3
import os

# Get database path
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "inventory.db")

def migrate():
    print(f"Connecting to database: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Check if column already exists
    cursor.execute("PRAGMA table_info(production)")
    columns = [row[1] for row in cursor.fetchall()]

    if 'employee_name' in columns:
        print("[OK] employee_name column already exists in production table.")
        conn.close()
        return

    print("Adding employee_name column to production table...")

    try:
        # Add new column
        cursor.execute("ALTER TABLE production ADD COLUMN employee_name TEXT")

        conn.commit()
        print("[SUCCESS] Added employee_name column to production table!")
        print("  - employee_name (TEXT)")

    except sqlite3.Error as e:
        print(f"[ERROR] Migration failed: {e}")
        conn.rollback()
        raise

    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
