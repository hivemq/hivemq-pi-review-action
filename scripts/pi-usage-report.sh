#!/usr/bin/env bash
# Monthly Pi reviewer usage report across the hivemq / hivemq-cloud fleet.
#
#   scripts/pi-usage-report.sh              # previous calendar month
#   scripts/pi-usage-report.sh 2026-07      # a specific month
#   scripts/pi-usage-report.sh 2026-07 md   # markdown table instead of text
#
# Consumers are discovered live via code search, so repos that adopt or drop the
# action are picked up automatically. EXTRA_WORKFLOWS covers repos that run Pi
# from an inlined fork and therefore never appear in that search.
#
# "Reviewed" is the number that matters: triggered runs minus the ones that were
# skipped by a path/branch filter or died in startup_failure. A repo can trigger
# hundreds of runs and review nothing.
set -euo pipefail

MONTH="${1:-$(date -v-1m +%Y-%m 2>/dev/null || date -d 'last month' +%Y-%m)}"
FORMAT="${2:-text}"
FROM="${MONTH}-01"
TO="$(date -j -v+1m -v-1d -f %Y-%m-%d "$FROM" +%Y-%m-%d 2>/dev/null \
      || date -d "$FROM +1 month -1 day" +%Y-%m-%d)"
RANGE="${FROM}..${TO}"

ORGS=(hivemq hivemq-cloud)

# repo:workflow-path pairs that code search cannot find (inlined forks).
EXTRA_WORKFLOWS=(
  "hivemq/hivemq-enterprise:.github/workflows/pi-pr-review.yml"
)

echo "Pi reviewer usage - ${MONTH} (${RANGE})" >&2
echo "discovering consumers..." >&2

# --- discover repo:path pairs -------------------------------------------------
pairs=()
for org in "${ORGS[@]}"; do
  while IFS=$'\t' read -r repo path; do
    [[ "$path" == .github/workflows/* ]] || continue
    [[ "$repo" == hivemq/hivemq-pi-review-action ]] && continue  # self-test runs
    pairs+=("${repo}:${path}")
  done < <(gh api -X GET "search/code?q=hivemq-pi-review-action+org:${org}&per_page=100" \
             --jq '.items[] | "\(.repository.full_name)\t\(.path)"')
done
pairs+=("${EXTRA_WORKFLOWS[@]}")

IFS=$'\n' pairs=($(printf '%s\n' "${pairs[@]}" | sort -u)); unset IFS

# --- collect per-repo run stats ----------------------------------------------
rows=()
for pair in "${pairs[@]}"; do
  repo="${pair%%:*}"
  path="${pair#*:}"

  # --paginate matters: repos with >30 workflows otherwise look like non-consumers.
  wf_id="$(gh api --paginate "repos/${repo}/actions/workflows" \
             --jq ".workflows[] | select(.path==\"${path}\") | .id" 2>/dev/null || true)"
  [[ -n "$wf_id" ]] || { echo "  ! ${repo} (${path}): workflow not found" >&2; continue; }

  runs="$(gh api --paginate \
            "repos/${repo}/actions/workflows/${wf_id}/runs?per_page=100&created=${RANGE}" \
            --jq '.workflow_runs[] | [.event, (.conclusion // "running"), .display_title] | @tsv' \
          2>/dev/null || true)"
  [[ -n "$runs" ]] || { echo "  ${repo}: no runs" >&2; continue; }

  triggered=$(wc -l <<<"$runs" | tr -d ' ')
  skipped=$(cut -f2 <<<"$runs" | grep -cx skipped || true)
  broken=$(cut -f2 <<<"$runs" | grep -cx startup_failure || true)
  reviewed=$((triggered - skipped - broken))

  live="$(awk -F'\t' '$2!="skipped" && $2!="startup_failure"' <<<"$runs")"
  if [[ -n "$live" ]]; then
    prs=$(cut -f3 <<<"$live" | sort -u | wc -l | tr -d ' ')
    ok=$(cut -f2 <<<"$live" | grep -cx success || true)
    fail=$(cut -f2 <<<"$live" | grep -cx failure || true)
    comment=$(cut -f1 <<<"$live" | grep -cx issue_comment || true)
  else
    prs=0; ok=0; fail=0; comment=0
  fi

  rows+=("${reviewed}"$'\t'"${prs}"$'\t'"${ok}"$'\t'"${fail}"$'\t'"${comment}"$'\t'"${triggered}"$'\t'"${repo}")
  echo "  ${repo}: ${reviewed}/${triggered}" >&2
done

# --- render -------------------------------------------------------------------
sorted="$(printf '%s\n' "${rows[@]}" | sort -rn -k1,1)"

t_rev=0; t_prs=0; t_ok=0; t_fail=0; t_trig=0
while IFS=$'\t' read -r reviewed prs ok fail _ triggered _; do
  t_rev=$((t_rev + reviewed)); t_prs=$((t_prs + prs))
  t_ok=$((t_ok + ok)); t_fail=$((t_fail + fail)); t_trig=$((t_trig + triggered))
done <<<"$sorted"

pct() { [[ "$2" -eq 0 ]] && echo "-" || echo "$((100 * $1 / $2))%"; }

echo
if [[ "$FORMAT" == md ]]; then
  echo "## Pi reviewer usage - ${MONTH}"
  echo
  echo "| Repository | Reviewed | PRs | Success | Failed | \`/review\` | Triggered |"
  echo "|---|--:|--:|--:|--:|--:|--:|"
  while IFS=$'\t' read -r reviewed prs ok fail comment triggered repo; do
    printf '| %s | %s | %s | %s | %s | %s | %s |\n' \
      "$repo" "$reviewed" "$prs" "$(pct "$ok" "$reviewed")" "$fail" "$comment" "$triggered"
  done <<<"$sorted"
  printf '| **Total** | **%s** | **%s** | **%s** | **%s** | | **%s** |\n' \
    "$t_rev" "$t_prs" "$(pct "$t_ok" "$t_rev")" "$t_fail" "$t_trig"
else
  printf '%-38s %9s %5s %8s %7s %8s %10s\n' \
    REPOSITORY REVIEWED PRS SUCCESS FAILED /review TRIGGERED
  while IFS=$'\t' read -r reviewed prs ok fail comment triggered repo; do
    printf '%-38s %9s %5s %8s %7s %8s %10s\n' \
      "$repo" "$reviewed" "$prs" "$(pct "$ok" "$reviewed")" "$fail" "$comment" "$triggered"
  done <<<"$sorted"
  printf '%-38s %9s %5s %8s %7s %8s %10s\n' \
    TOTAL "$t_rev" "$t_prs" "$(pct "$t_ok" "$t_rev")" "$t_fail" "" "$t_trig"
fi
