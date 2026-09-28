#!/usr/bin/env bash
# Runs pi, and once more if it fails. pi already retries rate limits and 5xx per
# request (see settings.json); this catches what it gives up on or never
# classifies as transient: aborts, unrecognised mid-stream provider errors, and
# a judge that exits cleanly without calling submit_review.
#
# Usage: pi-run.sh [--out FILE] [--require FILE] -- <pi args...>
#   --out FILE      tee stdout to FILE, truncated on each attempt
#   --require FILE  treat the attempt as failed unless FILE is non-empty
set -uo pipefail

out=""
require=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    --require) require="$2"; shift 2 ;;
    --) shift; break ;;
    *) echo "pi-run.sh: unknown option $1" >&2; exit 2 ;;
  esac
done

delay="${PI_RUN_RETRY_DELAY:-30}"
for attempt in 1 2; do
  [ -n "$require" ] && rm -f "$require"
  if [ -n "$out" ]; then
    pi "$@" | tee "$out"
  else
    pi "$@"
  fi
  status=$?
  if [ "$status" -eq 0 ] && [ -n "$require" ] && [ ! -s "$require" ]; then
    echo "pi exited 0 without writing $require"
    status=1
  fi
  [ "$status" -eq 0 ] && exit 0
  [ "$attempt" -eq 2 ] && exit "$status"
  echo "::warning::pi failed (exit $status); retrying once in ${delay}s"
  sleep "$delay"
done
