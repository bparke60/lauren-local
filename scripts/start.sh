#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -f .local/data-home ]; then
  LAUREN_DATA_DIR="$(cat .local/data-home)"
  export LAUREN_DATA_DIR
fi
if [ -f .local/home-binding.json ]; then
  home_binding="$(node scripts/home-env.mjs | base64)"
  # Decode each field through Node; do not source or evaluate a drive path.
  LAUREN_DATA_DIR="$(printf '%s' "$home_binding" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>process.stdout.write(Buffer.from(s,"base64").toString().split("\0")[0]))')"
  LAUREN_HOME_ID="$(printf '%s' "$home_binding" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>process.stdout.write(Buffer.from(s,"base64").toString().split("\0")[1]))')"
  export LAUREN_DATA_DIR LAUREN_HOME_ID
fi
if curl --silent --fail --max-time 2 http://127.0.0.1:4327/api/health >/dev/null; then
  node --input-type=module -e 'const h=await (await fetch("http://127.0.0.1:4327/api/health")).json();if((h.homeId||null)!==(process.env.LAUREN_HOME_ID||null))throw Error("Another Lauren core is using a different home. Quit it first.")'
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
