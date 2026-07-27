#!/usr/bin/env bash
# Stage 1 sensitivity gate — orchestrator.
#
# Decides whether a PR is a candidate for AI auto-approve+merge, or must be
# routed to a human. Runs in the resolve job (self-hosted 'pi' runner), needs
# no checkout: it reads everything through the GitHub API.
#
# The policy file and CODEOWNERS are read from the PR's BASE ref, never the
# head — a PR must not be able to weaken the gate that judges it.
#
# Required env:
#   REPO          owner/repo
#   PR_NUMBER     pull request number
#   GH_TOKEN      token with contents:read + pull-requests:read (+ issues:write
#                 to apply the human label in enforce mode)
# Optional env:
#   TRIGGER_KIND  auto | manual | comment | dispatch   (default: auto)
#   POLICY_PATH   default: .github/auto-approve.yml
#
# Outputs (to $GITHUB_OUTPUT when set, and always echoed):
#   auto-approve-eligible  true only if enabled + auto trigger + no gate hit
#   force-human            true if a hard rule sent this PR to a human
#   gate-reason            short machine reason
#   gate-mode              shadow | enforce | off
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/gate.sh
source "$SCRIPT_DIR/lib/gate.sh"

: "${REPO:?REPO is required}"
: "${PR_NUMBER:?PR_NUMBER is required}"
TRIGGER_KIND="${TRIGGER_KIND:-auto}"
POLICY_PATH="${POLICY_PATH:-.github/auto-approve.yml}"

eligible=false
force_human=false
reason=""
mode="off"

emit() {
  echo "auto-approve gate: eligible=$eligible force-human=$force_human mode=$mode reason=${reason:-none}"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
      echo "auto-approve-eligible=$eligible"
      echo "force-human=$force_human"
      echo "gate-reason=$reason"
      echo "gate-mode=$mode"
    } >> "$GITHUB_OUTPUT"
  fi
}

# Only the bot-applied 'review' label (checks-pass auto path) is ever eligible.
# A human-initiated review (/review comment, manual-review label, dispatch) is
# never a candidate for auto-approve.
if [ "$TRIGGER_KIND" != "auto" ]; then
  reason="trigger-not-auto"
  emit; exit 0
fi

# Fail safe: without gh we cannot evaluate the gate, so we simply decline to
# mark the PR eligible — we never approve blind. Never fail the run.
if ! command -v gh >/dev/null 2>&1; then
  reason="tooling-missing:gh"
  emit; exit 0
fi

# Fetch a file from the base ref; prints content on stdout, empty if absent.
# gh writes the 404 error body to stdout too, so we must key off its exit
# status — only echo the body when the request actually succeeded.
api_file() { # <path> <ref>
  local body
  if body="$(gh api -H "Accept: application/vnd.github.raw" \
      "repos/$REPO/contents/$1?ref=$2" 2>/dev/null)"; then
    printf '%s' "$body"
  fi
}

base_ref="$(gh api "repos/$REPO/pulls/$PR_NUMBER" --jq '.base.ref')"

policy="$(api_file "$POLICY_PATH" "$base_ref")"
if [ -z "$policy" ]; then
  reason="no-policy"
  emit; exit 0
fi

# yq is only needed once a policy exists (repos without one exit above). The
# runner provides it (same jq-syntax yq the review/judge jobs use); if it is
# absent we fail safe rather than approve blind. We do NOT auto-install — that
# risks pulling the wrong yq flavour.
if ! command -v yq >/dev/null 2>&1; then
  reason="tooling-missing:yq"
  emit; exit 0
fi

enabled="$(yq -r '.enabled // false' <<< "$policy")"
mode="$(yq -r '.mode // "shadow"' <<< "$policy")"
human_label="$(yq -r '.human_label // "human-review-required"' <<< "$policy")"
injection_enabled="$(yq -r '.prompt_injection_guard.enabled // true' <<< "$policy")"
mapfile -t human_paths < <(yq -r '.always_human_paths[]? // empty' <<< "$policy")
mapfile -t owner_teams < <(yq -r '.require.owner_teams[]? // empty' <<< "$policy")

if [ "$enabled" != "true" ]; then
  mode="off"; reason="policy-disabled"
  emit; exit 0
fi

mapfile -t changed < <(gh api --paginate "repos/$REPO/pulls/$PR_NUMBER/files" --jq '.[].filename')

# --- Rule 1: sensitive paths ------------------------------------------------
if [ "${#human_paths[@]}" -gt 0 ]; then
  for f in "${changed[@]}"; do
    if path_matches_any "$f" "${human_paths[@]}"; then
      force_human=true; reason="sensitive-path:$f"; break
    fi
  done
fi

# --- Rule 2: ownership (every changed file owned by an allowed team) ---------
if [ "$force_human" != "true" ] && [ "${#owner_teams[@]}" -gt 0 ]; then
  codeowners=""
  for cand in .github/CODEOWNERS CODEOWNERS docs/CODEOWNERS; do
    codeowners="$(api_file "$cand" "$base_ref")"
    [ -n "$codeowners" ] && break
  done
  for f in "${changed[@]}"; do
    owners_arr=()
    read -ra owners_arr <<< "$(codeowners_owners_for "$f" "$codeowners")" || true
    if ! owners_within_teams "${owners_arr[@]}" -- "${owner_teams[@]}"; then
      force_human=true; reason="ownership:$f"; break
    fi
  done
fi

# --- Rule 3: prompt-injection heuristic on title + body + diff ---------------
if [ "$force_human" != "true" ] && [ "$injection_enabled" = "true" ]; then
  meta="$(gh api "repos/$REPO/pulls/$PR_NUMBER" --jq '.title + "\n" + (.body // "")')"
  diff="$(gh api -H "Accept: application/vnd.github.diff" "repos/$REPO/pulls/$PR_NUMBER" 2>/dev/null || true)"
  if hit="$(injection_scan "$meta"$'\n'"$diff")"; then
    force_human=true; reason="prompt-injection:$hit"
  fi
fi

# --- Verdict ----------------------------------------------------------------
if [ "$force_human" = "true" ]; then
  eligible=false
  if [ "$mode" = "enforce" ]; then
    gh api -X POST "repos/$REPO/issues/$PR_NUMBER/labels" \
      -f "labels[]=$human_label" >/dev/null 2>&1 \
      && echo "Applied '$human_label' label." \
      || echo "WARN: could not apply '$human_label' label (needs issues:write)."
  else
    echo "SHADOW: would apply '$human_label' label and block auto-approve."
  fi
else
  eligible=true; reason="candidate"
fi

emit
