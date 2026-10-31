#!/bin/bash
set -eu
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if curl --silent --max-time 2 http://127.0.0.1:4327/api/health >/dev/null; then
  echo "Lauren is already running on port 4327."
  exit 0
fi
if [ -f .local/voice-python ]; then
  LAUREN_VOICE_PYTHON="$(cat .local/voice-python)"
  export LAUREN_VOICE_PYTHON
fi
if [ -x "$HOME/.lmstudio/bin/lms" ]; then
  "$HOME/.lmstudio/bin/lms" server start --port 5321 || true
fi
exec node src/server.js
