# Deployment & Optimization Guide

This guide covers deploying the Ice Cream Inventory app to Render's free tier with optimizations to minimize cold starts.

## Table of Contents
- [Quick Deploy to Render](#quick-deploy-to-render)
- [Optimization: Eliminate Cold Starts (FREE)](#optimization-eliminate-cold-starts-free)
- [Optional: Advanced Optimizations](#optional-advanced-optimizations)
- [Performance Comparison](#performance-comparison)

---

## Quick Deploy to Render

### 1. Create a Render Account
1. Go to [render.com](https://render.com)
2. Sign up with GitHub (recommended for auto-deploy)

### 2. Create a New Web Service
1. Click **"New +"** → **"Web Service"**
2. Connect your GitHub repository
3. Configure:
   - **Name:** `icecream-inventory` (or your choice)
   - **Region:** Choose closest to you
   - **Branch:** `main` (or your default branch)
   - **Root Directory:** Leave blank
   - **Runtime:** Python 3
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `bash start.sh`
   - **Instance Type:** Free

### 3. Set Environment Variables
In Render dashboard, add:
- **Key:** `ANTHROPIC_API_KEY`
- **Value:** Your Claude API key (optional, for AI insights)

### 4. Deploy
- Click **"Create Web Service"**
- Render will build and deploy your app
- First deployment takes ~3-5 minutes
- Your app will be available at `https://your-app-name.onrender.com`

---

## Optimization: Eliminate Cold Starts (FREE)

**Problem:** Render free tier puts apps to sleep after 15 minutes of inactivity. Wake-up time = 30+ seconds.

**Solution:** Use UptimeRobot to ping your app every 5 minutes, keeping it awake 24/7.

### Why This Works
- **Cold starts happen** when the app sleeps (15 min inactivity)
- **UptimeRobot pings** your `/health` endpoint every 5 minutes
- **App stays awake** continuously → **zero cold starts**
- **100% FREE** - no cost for either service

### Step-by-Step Setup (5 minutes)

#### 1. Verify Health Endpoint Works
Once your app is deployed, test the health endpoint:
```bash
curl https://your-app-name.onrender.com/health
```

You should see:
```json
{
  "status": "healthy",
  "timestamp": "2026-02-15T12:34:56.789012"
}
```

#### 2. Sign Up for UptimeRobot
1. Go to [uptimerobot.com](https://uptimerobot.com)
2. Create a free account (no credit card needed)
3. Verify your email

#### 3. Add Your App as a Monitor
1. Click **"+ Add New Monitor"**
2. Configure:
   - **Monitor Type:** HTTP(s)
   - **Friendly Name:** Ice Cream App
   - **URL:** `https://your-app-name.onrender.com/health`
   - **Monitoring Interval:** 5 minutes
   - **Monitor Timeout:** 30 seconds
3. Click **"Create Monitor"**

#### 4. Verify It's Working
1. Wait 15+ minutes (let Render try to put app to sleep)
2. Visit your app: `https://your-app-name.onrender.com`
3. Should load **instantly** (no 30-second cold start!)
4. Check UptimeRobot dashboard - should show **"Up"** status

### Performance Impact

| Metric | Before UptimeRobot | After UptimeRobot |
|--------|-------------------|-------------------|
| First load after 15+ min idle | 30+ seconds | < 3 seconds |
| Subsequent loads | Instant | Instant |
| Cost | $0/month | $0/month |

### Alternative Free Services

If UptimeRobot doesn't work for you, try:
- **Cron-Job.org** - 1-minute intervals (even better!)
- **Freshping** - 1-minute intervals
- **StatusCake** - 5-minute intervals (free tier)

All work the same way - just point them at your `/health` endpoint.

---

## Optional: Advanced Optimizations

### Split Frontend to Vercel (Better UX)

**Why?** Frontend loads instantly (like a pure SPA), backend wakes in background.

**Setup:**
1. Create `vercel.json` in project root:
```json
{
  "buildCommand": "echo 'No build needed'",
  "outputDirectory": "frontend",
  "cleanUrls": true,
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

2. Update frontend to use full API URL (in `frontend/app.js`):
```javascript
const API_BASE = 'https://your-app.onrender.com';
// Update all fetch calls:
fetch(`${API_BASE}/api/flavors`)
```

3. Update CORS in `backend/app.py`:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "*",  # Keep for development
        "https://your-app.vercel.app"  # Add your Vercel URL
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

4. Deploy to Vercel:
   - Sign up at vercel.com
   - Connect GitHub repo
   - Deploy (auto-detects static site)

**Result:**
- Frontend loads instantly from Vercel CDN
- Backend stays warm via UptimeRobot
- Professional appearance, 100% free

---

## Performance Comparison

### Current Setup (Optimized)
- **Hosting:** Render free tier
- **Keep-Alive:** UptimeRobot (5-min pings)
- **Startup:** Gunicorn + optimized imports
- **Cold Start:** Eliminated (app always warm)
- **Load Time:** < 3 seconds
- **Cost:** $0/month

### Bid Buddy (Reference - Pure Frontend)
- **Hosting:** Vercel (static)
- **Backend:** None (Supabase)
- **Load Time:** Instant (< 1 second)
- **Cost:** $0/month

### Why Ice Cream App Can't Match Bid Buddy Speed
- **Bid Buddy:** Pure static site, no server needed
- **Ice Cream App:** Needs Python server for SQLite database
- **Best we can do:** Keep server warm (UptimeRobot) + optimize startup

---

## Troubleshooting

### App still slow after UptimeRobot setup
- Check UptimeRobot dashboard - is monitor running?
- Verify health endpoint responds: `curl https://your-app.onrender.com/health`
- Check Render logs for errors

### UptimeRobot shows "Down" status
- Check if app is actually running in Render dashboard
- Verify health endpoint path is correct (`/health`, not `/api/health`)
- Check Render logs for startup errors

### "This service has been shut down" error
- Render free tier has monthly bandwidth limits
- If exceeded, upgrade to paid tier or wait for next month
- Note: UptimeRobot uses minimal bandwidth (~1MB/month)

### Build fails on Render
- Check `requirements.txt` is in project root
- Verify `start.sh` has correct path to backend
- Check Render build logs for specific error

---

## Deployment Checklist

- [ ] App deployed to Render and accessible
- [ ] `/health` endpoint returns `{"status": "healthy"}`
- [ ] `ANTHROPIC_API_KEY` environment variable set (optional)
- [ ] UptimeRobot monitor created and pinging every 5 minutes
- [ ] Tested: App loads quickly after 15+ min idle
- [ ] (Optional) Frontend deployed to Vercel for instant loads

---

## Cost Breakdown

| Service | Cost | Purpose |
|---------|------|---------|
| Render (free tier) | $0/month | Backend hosting (Python + SQLite) |
| UptimeRobot (free) | $0/month | Keep-alive pings (prevents cold starts) |
| Vercel (optional) | $0/month | Frontend hosting (instant loads) |
| **Total** | **$0/month** | Full production deployment |

---

## Next Steps

1. **Deploy to Render** (10 minutes)
2. **Set up UptimeRobot** (5 minutes) ← **Biggest impact, do this first!**
3. **Test cold start elimination** (wait 15 min, then access app)
4. **(Optional) Deploy frontend to Vercel** (2-3 hours) - for even better UX

---

## Need Help?

- **Render docs:** https://render.com/docs
- **UptimeRobot docs:** https://uptimerobot.com/help
- **Vercel docs:** https://vercel.com/docs
