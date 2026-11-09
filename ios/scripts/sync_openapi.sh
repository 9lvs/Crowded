#!/usr/bin/env bash
# Refresh the iOS copy of the API contract after backend changes.
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 ios/scripts/sync_openapi.py "$@"
