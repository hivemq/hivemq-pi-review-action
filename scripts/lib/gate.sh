#!/usr/bin/env bash
# Stage 1 sensitivity gate — pure helpers (no network, no side effects).
#
# These functions decide whether a PR must go to a human before the AI
# approver is ever allowed to run. They are deliberately free of GitHub API
# calls so they can be unit-tested (see tests/gate.bats). The orchestrator
# (scripts/auto-approve-gate.sh) fetches the inputs and calls into here.

# Convert an auto-approve.yml path glob into an anchored ERE.
#   **/*.tf        -> ^(.*/)?[^/]*\.tf$
#   terraform/**   -> ^terraform/.*$
#   .github/**     -> ^\.github/.*$
#   **/CODEOWNERS  -> ^(.*/)?CODEOWNERS$
glob_to_regex() {
  local re="$1"
  re="${re//./\\.}"                       # escape dots first
  re="${re//\*\*\//@@DSS@@}"              # placeholder for **/
  re="${re//\*\*/@@DS@@}"                 # placeholder for **
  re="${re//\*/[^/]*}"                    # single * -> no-slash wildcard
  re="${re//@@DSS@@/(.*/)?}"              # **/  -> optional any-depth prefix
  re="${re//@@DS@@/.*}"                   # **   -> any
  printf '^%s$' "$re"
}

# path_matches_any <path> <glob>...
# Returns 0 (match) if <path> matches any of the globs, 1 otherwise.
path_matches_any() {
  local path="$1"; shift
  local glob
  for glob in "$@"; do
    [ -n "$glob" ] || continue
    if printf '%s' "$path" | grep -Eq "$(glob_to_regex "$glob")"; then
      return 0
    fi
  done
  return 1
}

# Convert a CODEOWNERS pattern into an anchored ERE, following the subset of
# gitignore semantics GitHub applies: leading '/' anchors at root, trailing
# '/' matches directory contents, a pattern without any slash matches at any
# depth, and a bare '*' matches everything.
codeowners_pattern_to_regex() {
  local p="$1"
  if [ "$p" = "*" ]; then
    printf '^.*$'
    return
  fi
  local anchored=0 dir=0
  case "$p" in
    /*) anchored=1; p="${p#/}" ;;
  esac
  case "$p" in
    */) dir=1; p="${p%/}" ;;
  esac
  # A pattern with an interior slash is anchored at the repo root even without
  # a leading slash; one with no slash matches at any depth (gitignore rule).
  case "$p" in
    */*) anchored=1 ;;
  esac
  local re="$p"
  re="${re//./\\.}"
  re="${re//\*\*\//@@DSS@@}"
  re="${re//\*\*/@@DS@@}"
  re="${re//\*/[^/]*}"
  re="${re//@@DSS@@/(.*/)?}"
  re="${re//@@DS@@/.*}"
  [ "$anchored" -eq 1 ] || re="(.*/)?$re"
  [ "$dir" -eq 0 ] || re="$re/.*"
  printf '^%s$' "$re"
}

# codeowners_owners_for <path> <codeowners_content>
# Prints the owners (space-separated) of the LAST matching rule — GitHub's
# last-match-wins semantics. Prints nothing if the path is unowned.
codeowners_owners_for() {
  local path="$1" content="$2"
  local line pattern owners match=""
  while IFS= read -r line; do
    line="${line%%#*}"                    # strip comments
    line="${line#"${line%%[![:space:]]*}"}"   # ltrim
    line="${line%"${line##*[![:space:]]}"}"   # rtrim
    [ -n "$line" ] || continue
    pattern="${line%%[[:space:]]*}"
    owners="${line#"$pattern"}"
    owners="${owners#"${owners%%[![:space:]]*}"}"
    if printf '%s' "$path" | grep -Eq "$(codeowners_pattern_to_regex "$pattern")"; then
      match="$owners"
    fi
  done <<< "$content"
  printf '%s' "$match"
}

# normalize_team <token> -> bare team slug (drops leading @ and org/ prefix).
#   @hivemq/hivemq-team-platform -> hivemq-team-platform
normalize_team() {
  local t="${1#@}"
  printf '%s' "${t##*/}"
}

# owners_within_teams <owners> -- <allowed_team>...
# Returns 0 only if <owners> is non-empty AND every owner is one of the allowed
# teams (compared by bare slug, so config may use 'hivemq-team-platform' or the
# full '@hivemq/hivemq-team-platform'). Unowned paths return 1 (force human).
owners_within_teams() {
  local -a owners=() allowed=()
  local seen_sep=0 tok
  for tok in "$@"; do
    if [ "$tok" = "--" ]; then seen_sep=1; continue; fi
    if [ "$seen_sep" -eq 0 ]; then owners+=("$tok"); else allowed+=("$tok"); fi
  done
  [ "${#owners[@]}" -gt 0 ] || return 1
  local o a ok
  for o in "${owners[@]}"; do
    ok=1
    for a in "${allowed[@]}"; do
      if [ "$(normalize_team "$o")" = "$(normalize_team "$a")" ]; then ok=0; break; fi
    done
    [ "$ok" -eq 0 ] || return 1
  done
  return 0
}

# Prompt-injection heuristics. Each entry is "label|ERE". A hit forces a human
# review; this is a guard, not a classifier — bias toward flagging.
INJECTION_PATTERNS=(
  'ignore-instructions|(ignore|disregard|forget)[[:space:]]+(all[[:space:]]+)?(your[[:space:]]+|the[[:space:]]+|any[[:space:]]+)?(previous[[:space:]]+|prior[[:space:]]+|above[[:space:]]+)?(instructions|rules|prompt)'
  'role-override|you[[:space:]]+are[[:space:]]+now|new[[:space:]]+instructions:|system[[:space:]]+prompt'
  'approve-directive|(auto[[:space:]-]?approve|approve[[:space:]]+this[[:space:]]+(pr|pull[[:space:]]+request|change)|lgtm[[:space:]]+auto)'
  'reviewer-address|(as[[:space:]]+the[[:space:]]+(ai[[:space:]]+)?reviewer|dear[[:space:]]+(ai[[:space:]]+)?reviewer|hey[[:space:]]+pi\b)'
  'judge-forgery|<!--[[:space:]]*pi-judge|pi-judge[[:space:]]*-->'
)

# injection_scan <text> -> prints the label of the first pattern that hits.
injection_scan() {
  local text="$1" entry label pat
  for entry in "${INJECTION_PATTERNS[@]}"; do
    label="${entry%%|*}"
    pat="${entry#*|}"
    if printf '%s' "$text" | grep -Eiq "$pat"; then
      printf '%s' "$label"
      return 0
    fi
  done
  return 1
}
