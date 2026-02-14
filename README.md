# Scoop Tracker — Ice Cream Flavor Inventory Intelligence

Track flavor-level inventory across tubs, pints, and quarts. Replaces paper tally sheets with a mobile-first web app + AI-powered insights.

## Quick Start

```bash
# Install dependencies
cd icecream-inventory
pip install -r requirements.txt

# Seed the database with real flavors + sample data
cd backend
python seed.py

# Run the server
python app.py
```

Open **http://localhost:8000** in your browser (works great on phone too).

## How It Works

### Daily Workflow
1. **Log production** when batches are made (tap flavor → type → quantity)
2. **Nightly count** before close (smart defaults pre-filled, just adjust what's wrong)
3. **Dashboard** shows inventory, consumption trends, alerts, and AI insights

### Core Formula
```
Consumed = Previous Count + Produced Since − Current Count
```

### AI Insights (optional)
Set `ANTHROPIC_API_KEY` environment variable to enable Claude-powered:
- Demand predictions by day of week
- "Make list" recommendations for tomorrow
- Waste/anomaly detection
- Weekly plain-English summaries

## Tech Stack
- **Frontend:** Vanilla HTML/CSS/JS, Chart.js, mobile-first
- **Backend:** Python FastAPI
- **Database:** SQLite
- **AI:** Claude API (Sonnet)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/flavors` | List active flavors |
| POST | `/api/flavors` | Add a flavor |
| PUT | `/api/flavors/{id}` | Update a flavor |
| DELETE | `/api/flavors/{id}` | Archive a flavor |
| POST | `/api/production` | Log production |
| GET | `/api/production` | Recent production history |
| POST | `/api/counts` | Submit nightly counts |
| GET | `/api/counts/smart-defaults` | Get pre-filled count estimates |
| GET | `/api/counts/history` | Count history |
| GET | `/api/dashboard/inventory` | Current on-hand inventory |
| GET | `/api/dashboard/consumption` | Daily consumption data |
| GET | `/api/dashboard/popularity` | Flavor popularity ranking |
| GET | `/api/dashboard/alerts` | Low stock alerts |
| GET | `/api/dashboard/production-vs-consumption` | Compare production to sales |
| GET | `/api/insights` | AI-generated insights |
