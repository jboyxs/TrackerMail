#!/bin/sh
set -eu

# Existing named volumes may have been created by the former root container.
# Repair only the application data directory, then drop privileges permanently.
chown -R app:app /data
exec su app -s /bin/sh -c 'exec /app/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --no-access-log'
