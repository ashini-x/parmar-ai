#!/usr/bin/env bash
set -euo pipefail

command -v node >/dev/null || { echo "Node.js is not installed."; exit 1; }
command -v git >/dev/null || { echo "Git is not installed."; exit 1; }

npm install
npm run types
npm run check
npm test

echo "Phase A local setup completed successfully."
