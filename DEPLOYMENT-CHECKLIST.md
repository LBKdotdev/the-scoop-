# Deployment Checklist

Use this checklist to track your deployment progress. Estimated total time: **20 minutes**.

---

## Phase 1: Code Ready ✅ (Already Done!)

- [x] Health endpoint added to `backend/app.py`
- [x] Gunicorn added to `requirements.txt`
- [x] AI insights lazy-loaded for faster startup
- [x] Production start script created (`start.sh`)
- [x] Documentation created

**Status:** All code optimizations complete! Ready to deploy.

---

## Phase 2: Deploy to Render (10 minutes)

### Step 1: Create Render Account
- [ ] Go to https://render.com
- [ ] Sign up with GitHub account
- [ ] Verify email if required

### Step 2: Create Web Service
- [ ] Click "New +" → "Web Service"
- [ ] Connect your GitHub repository
- [ ] Select the `icecream-inventory` repository

### Step 3: Configure Service
```
Name:          icecream-inventory (or your choice)
Region:        [Choose closest to you]
Branch:        main
Root Directory: [Leave blank]
Runtime:       Python 3
Build Command: pip install -r requirements.txt
Start Command: bash start.sh
Instance Type: Free
```

- [ ] Name configured
- [ ] Region selected
- [ ] Branch set to `main`
- [ ] Build command: `pip install -r requirements.txt`
- [ ] Start command: `bash start.sh`
- [ ] Instance type: **Free**

### Step 4: Environment Variables
- [ ] Click "Add Environment Variable"
- [ ] Key: `ANTHROPIC_API_KEY`
- [ ] Value: [Your Claude API key] (optional, for AI insights)

### Step 5: Deploy
- [ ] Click "Create Web Service"
- [ ] Wait for build to complete (3-5 minutes)
- [ ] Note your app URL: `https://________________.onrender.com`

### Step 6: Verify Deployment
- [ ] Visit your app URL - does it load?
- [ ] Test health endpoint:
  ```bash
  curl https://your-app-name.onrender.com/health
  ```
- [ ] Should return: `{"status": "healthy", "timestamp": "..."}`

**✓ Render deployment complete!**

---

## Phase 3: Eliminate Cold Starts with UptimeRobot (5 minutes)

### Step 1: Sign Up for UptimeRobot
- [ ] Go to https://uptimerobot.com
- [ ] Click "Free Sign Up"
- [ ] Create account (no credit card needed)
- [ ] Verify email

### Step 2: Add Monitor
- [ ] Click "+ Add New Monitor"
- [ ] Configure monitor:
  ```
  Monitor Type:     HTTP(s)
  Friendly Name:    Ice Cream Inventory
  URL:              https://[your-app].onrender.com/health
  Monitoring Interval: 5 minutes
  Monitor Timeout:  30 seconds
  ```
- [ ] Monitor type: HTTP(s)
- [ ] Friendly name: Ice Cream Inventory
- [ ] URL: `https://________________.onrender.com/health`
- [ ] Interval: 5 minutes
- [ ] Click "Create Monitor"

### Step 3: Verify UptimeRobot is Working
- [ ] Monitor shows "Up" status in dashboard
- [ ] Green checkmark visible
- [ ] Wait 5 minutes, check monitor pings successfully

**✓ UptimeRobot configured!**

---

## Phase 4: Test Cold Start Elimination (15 minutes)

### Step 1: Initial Test
- [ ] Visit your app now - note load time: _______ seconds

### Step 2: Wait for Cold Start Test
- [ ] Wait 15+ minutes (grab coffee, take a break)
- [ ] Set timer to remind you

### Step 3: Test After Idle Time
- [ ] Visit app again after 15+ minutes
- [ ] Load time: _______ seconds (should be < 5 sec, not 30+)
- [ ] App loads quickly? **YES / NO**

### Step 4: Verify UptimeRobot Activity
- [ ] Check UptimeRobot dashboard
- [ ] Should show recent pings (within last 5 minutes)
- [ ] Should show "Up" status

**✓ If loads quickly, cold starts eliminated successfully!**

---

## Phase 5: Final Verification (5 minutes)

### Functionality Tests
- [ ] Homepage loads correctly
- [ ] Flavors page works
- [ ] Production logging works
- [ ] Daily count submission works
- [ ] Dashboard displays correctly
- [ ] AI insights work (if API key set)

### Performance Tests
- [ ] Health endpoint responds: `/health`
- [ ] API endpoints respond quickly
- [ ] No errors in browser console
- [ ] No errors in Render logs

### Monitoring
- [ ] UptimeRobot monitor is active
- [ ] Receiving uptime emails (optional)
- [ ] Bookmarked Render dashboard
- [ ] Bookmarked UptimeRobot dashboard

**✓ All tests passed!**

---

## Optional: Advanced Optimizations

### Vercel Frontend Split (2-3 hours) - For Instant Loads
See [DEPLOYMENT.md](DEPLOYMENT.md#split-frontend-to-vercel-better-ux) for full guide.

- [ ] Create `vercel.json` config
- [ ] Update API base URL in frontend
- [ ] Configure CORS in FastAPI
- [ ] Deploy to Vercel
- [ ] Test frontend → backend communication
- [ ] Update UptimeRobot to keep backend warm

---

## Troubleshooting

### If app doesn't load:
- [ ] Check Render dashboard - is service running?
- [ ] Check Render logs for errors
- [ ] Verify `start.sh` exists in repository
- [ ] Verify `requirements.txt` has all dependencies

### If health endpoint fails:
- [ ] Check URL path is `/health` (not `/api/health`)
- [ ] Check Render logs for app startup errors
- [ ] Try manual curl: `curl https://your-app.onrender.com/health`

### If UptimeRobot shows "Down":
- [ ] Verify app is running in Render
- [ ] Check health endpoint URL is correct
- [ ] Check UptimeRobot monitor settings

### If app is still slow after 15+ min:
- [ ] Verify UptimeRobot monitor is active (not paused)
- [ ] Check UptimeRobot is pinging every 5 minutes
- [ ] Check Render logs - is app receiving pings?

---

## Success Criteria

Your deployment is successful when:

✅ App loads at `https://[your-app].onrender.com`
✅ Health endpoint returns `{"status": "healthy"}`
✅ UptimeRobot shows "Up" status
✅ App loads in < 5 seconds after 15+ min idle
✅ All features work correctly
✅ Cost is $0/month

---

## Quick Reference

### Your URLs
```
App URL:      https://________________.onrender.com
Health URL:   https://________________.onrender.com/health
Render Dashboard: https://dashboard.render.com
UptimeRobot:  https://uptimerobot.com/dashboard
```

### Key Commands
```bash
# Test health endpoint
curl https://your-app.onrender.com/health

# View Render logs
# (Go to Render dashboard → Your service → Logs tab)

# Local development
cd icecream-inventory/backend
python app.py
```

---

## Notes

Use this space to track any issues or customizations:

```
[Your notes here]
```

---

**Current Status:** ________________

**Deployment Date:** ________________

**Next Review Date:** ________________

---

**Need help?** See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed troubleshooting.
