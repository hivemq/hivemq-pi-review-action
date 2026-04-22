#!/usr/bin/env bash
# CI check: regenerate prompts.ts and fail if the result differs from the
# committed version. Catches forgotten regens after editing prompts/*.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/gen-prompts.sh"

REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
if ! git diff --exit-code extensions/models/adversarial_review/prompts.ts; then
  echo "error: prompts.ts is out of date — run scripts/gen-prompts.sh and commit the result" >&2
  exit 1
fi
