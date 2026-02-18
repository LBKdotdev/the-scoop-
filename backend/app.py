import sys
import os

# Ensure backend/ is on the path for imports
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from database import init_db, get_db
from routes import flavors, production, counts, dashboard, reports, voice

app = FastAPI(title="Ice Cream Inventory Tracker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register route modules
app.include_router(flavors.router)
app.include_router(production.router)
app.include_router(counts.router)
app.include_router(dashboard.router)
app.include_router(reports.router)
app.include_router(voice.router)


def run_migrations():
    """Run database migrations on startup (for Render free tier without Shell access)"""
    import sqlite3
    import os

    # Get database path
    db_path = os.path.join(os.path.dirname(__file__), "..", "inventory.db")

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Check and add variance columns to daily_counts
        cursor.execute("PRAGMA table_info(daily_counts)")
        columns = [col[1] for col in cursor.fetchall()]

        if "predicted_count" not in columns:
            print("Adding variance tracking columns to daily_counts...")
            cursor.execute("ALTER TABLE daily_counts ADD COLUMN predicted_count REAL")
            cursor.execute("ALTER TABLE daily_counts ADD COLUMN variance REAL")
            cursor.execute("ALTER TABLE daily_counts ADD COLUMN variance_pct REAL")
            print("✓ Variance columns added")

        if "employee_name" not in columns:
            print("Adding employee_name to daily_counts...")
            cursor.execute("ALTER TABLE daily_counts ADD COLUMN employee_name TEXT")
            print("✓ Employee name column added to daily_counts")

        # Check and add employee_name to production
        cursor.execute("PRAGMA table_info(production)")
        prod_columns = [col[1] for col in cursor.fetchall()]

        if "employee_name" not in prod_columns:
            print("Adding employee_name to production...")
            cursor.execute("ALTER TABLE production ADD COLUMN employee_name TEXT")
            print("✓ Employee name column added to production")

        # Add soft delete columns to production
        if "deleted_at" not in prod_columns:
            print("Adding soft delete tracking to production...")
            cursor.execute("ALTER TABLE production ADD COLUMN deleted_at TEXT")
            cursor.execute("ALTER TABLE production ADD COLUMN deleted_by TEXT")
            print("✓ Soft delete columns added to production")

        conn.commit()
        conn.close()
        print("✓ All migrations completed successfully")

    except Exception as e:
        print(f"Migration error (may be safe to ignore if columns already exist): {e}")


@app.on_event("startup")
def on_startup():
    init_db()
    # Run migrations automatically on startup
    run_migrations()


@app.get("/health")
def health_check():
    """Health check endpoint for monitoring services like UptimeRobot"""
    from datetime import datetime
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat()
    }


@app.get("/api/insights")
def get_insights(db: Session = Depends(get_db)):
    # Lazy load AI insights to speed up app startup
    from ai_insights import generate_insights
    inv = dashboard.current_inventory(db=db)
    cons = dashboard.daily_consumption(days=7, db=db)
    alerts = dashboard.low_stock_alerts(db=db)
    pvc = dashboard.production_vs_consumption(days=7, db=db)
    return generate_insights(inv, cons, alerts, pvc)


# Serve frontend
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")


@app.get("/")
def serve_index():
    return FileResponse(os.path.join(frontend_dir, "index.html"))


app.mount("/static", StaticFiles(directory=frontend_dir), name="static")


if __name__ == "__main__":
    import uvicorn
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True, reload_dirs=[backend_dir])
