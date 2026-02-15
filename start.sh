#!/bin/bash
# Production start script for Render deployment
# Uses gunicorn with uvicorn workers for better performance

cd backend
gunicorn -w 1 -k uvicorn.workers.UvicornWorker app:app --bind 0.0.0.0:${PORT:-8000}
