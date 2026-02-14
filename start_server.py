import os
import sys

# Change to backend directory
backend_dir = os.path.join(os.path.dirname(__file__), 'backend')
os.chdir(backend_dir)
sys.path.insert(0, backend_dir)

# Import and run
import uvicorn
uvicorn.run('app:app', host='0.0.0.0', port=8000, reload=False)
