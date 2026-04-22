#!/usr/bin/env bash
# Push the adversarial-review extension: regenerate prompts.ts from the
# .md sources, then push to the swamp registry. Forwards any extra args
# (e.g. --dry-run, -y) to `swamp extension push`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

"$SCRIPT_DIR/gen-prompts.sh"

cd "$REPO_ROOT"
exec swamp extension push manifest.yaml "$@"
