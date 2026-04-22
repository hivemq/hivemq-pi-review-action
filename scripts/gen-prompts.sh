#!/usr/bin/env bash
# Regenerate extensions/models/adversarial_review/prompts.ts from its
# adjacent prompts/*.md files. Uses the deno bundled with swamp so no
# separate deno install is required.
set -euo pipefail

DENO="${SWAMP_DENO:-${HOME}/.swamp/deno/deno}"
if [ ! -x "$DENO" ]; then
  echo "error: deno not found at $DENO (install swamp or set SWAMP_DENO)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$DENO" run --allow-read --allow-write \
  "$REPO_ROOT/extensions/models/adversarial_review/gen_prompts.ts"

# Match deno fmt so `swamp extension fmt --check` stays clean.
"$DENO" fmt --quiet \
  "$REPO_ROOT/extensions/models/adversarial_review/prompts.ts"
