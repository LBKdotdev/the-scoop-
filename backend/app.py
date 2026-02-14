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
from routes import flavors, production, counts, dashboard, reports
from ai_insights import generate_insights

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


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/api/insights")
def get_insights(db: Session = Depends(get_db)):
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
