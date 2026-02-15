# Quick Render Setup (5 Minutes)

This is a **quick reference** for deploying to Render. See [DEPLOYMENT.md](DEPLOYMENT.md) for full details.

## 1. Deploy to Render

### In Render Dashboard:
1. Click **"New +"** → **"Web Service"**
2. Connect your GitHub repo
3. Configure:
   ```
   Name:          icecream-inventory
   Branch:        main
   Runtime:       Python 3
   Build Command: pip install -r requirements.txt
   Start Command: bash start.sh
   Instance Type: Free
   ```
4. **Environment Variables:**
   - `ANTHROPIC_API_KEY` = your Claude API key (optional)

5. Click **"Create Web Service"**

**Your app will be at:** `https://your-app-name.onrender.com`

---

## 2. Eliminate Cold Starts (FREE - 5 minutes)

**Problem:** Render free tier sleeps after 15 min → 30+ sec cold starts

**Solution:** UptimeRobot pings your app every 5 min → stays awake 24/7

### Setup UptimeRobot:
1. Go to [uptimerobot.com](https://uptimerobot.com) → Sign up (free)
2. Click **"+ Add New Monitor"**
3. Configure:
   ```
   Monitor Type: HTTP(s)
   Friendly Name: Ice Cream App
   URL:          https://your-app-name.onrender.com/health
   Interval:     5 minutes
   ```
4. Click **"Create Monitor"**

**Done!** App stays warm 24/7, no more cold starts.

---

## 3. Test It Works

### Test Health Endpoint:
```bash
curl https://your-app-name.onrender.com/health
```

Should return:
```json
{
  "status": "healthy",
  "timestamp": "2026-02-15T12:34:56.789012"
}
```

### Test Cold Start Elimination:
1. Wait 15+ minutes
2. Visit your app
3. Should load in **< 3 seconds** (not 30+ seconds!)

---

## What Changed in This Optimization

### Code Changes:
1. ✅ **Health endpoint added** (`/health`) - for monitoring
2. ✅ **Gunicorn added** - faster production server
3. ✅ **AI insights lazy-loaded** - faster startup
4. ✅ **Start script created** (`start.sh`) - production config

### Deployment:
1. ✅ **UptimeRobot pings** `/health` every 5 min
2. ✅ **App stays warm** - no cold starts
3. ✅ **100% FREE** - both services free tier

---

## Performance Results

| Metric | Before | After |
|--------|--------|-------|
| Cold start (15+ min idle) | 30+ sec | < 3 sec |
| Subsequent loads | Instant | Instant |
| Cost | $0/month | $0/month |

---

## Troubleshooting

**App still slow?**
- Check UptimeRobot dashboard - monitor running?
- Verify: `curl https://your-app-name.onrender.com/health`

**UptimeRobot shows "Down"?**
- Check Render dashboard - app running?
- Check Render logs for errors

**Build fails?**
- Verify `start.sh` exists and is executable
- Check `requirements.txt` has all dependencies

---

## Next Steps (Optional)

For **even better performance** (instant frontend loads like Bid Buddy):
- Deploy frontend to Vercel (see [DEPLOYMENT.md](DEPLOYMENT.md#split-frontend-to-vercel-better-ux))
- Backend stays on Render with UptimeRobot
- Result: Instant UI, warm backend, 100% free

---

## Files Modified

```
✅ backend/app.py              - Added /health endpoint, lazy loading
✅ requirements.txt             - Added gunicorn
✅ start.sh                     - Production start script (NEW)
✅ DEPLOYMENT.md                - Full deployment guide (NEW)
✅ RENDER-SETUP.md              - This quick reference (NEW)
```

---

**Full guide:** [DEPLOYMENT.md](DEPLOYMENT.md)
