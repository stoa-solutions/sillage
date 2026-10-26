#!/bin/sh
# Shared board of work in progress for every worktree of this clone.
# Stored in the common git directory: visible from each worktree, never committed.
set -eu
board="$(git rev-parse --git-common-dir)/agents-board.tsv"
lock="$board.lock"
touch "$board"
# mkdir is atomic: claim and release hold the lock for the whole read-modify-replace.
locked() {
  tries=0
  tmp=""
  until mkdir "$lock" 2>/dev/null; do
    tries=$((tries + 1))
    [ "$tries" -lt 50 ] || { echo "Tableau verrouillé ; supprimer $lock s'il est orphelin." >&2; exit 1; }
    sleep 0.1
  done
  trap 'rm -f "$tmp"; rmdir "$lock"' EXIT
  trap 'exit 130' INT TERM
  tmp=$(mktemp "$board.XXXXXX")
  "$@"
  mv "$tmp" "$board"
}
write_claim() {
  others
  printf '%s\t%s\t%s\t%s\n' "$agent" "$branch" "$zones" "$(date '+%Y-%m-%d %H:%M')" >> "$tmp"
}
write_release() { others; }
# Branch names are compared literally, never as patterns.
others() { awk -F '\t' -v branch="$branch" '$2 != branch' "$board" > "$tmp"; }
case "${1:-list}" in
  list)
    if [ -s "$board" ]; then
      printf 'AGENT\tBRANCHE\tZONES\tDEPUIS\n'
      cat "$board"
    else
      echo "Aucun travail en cours déclaré."
    fi
    echo
    git worktree list
    ;;
  claim)
    [ $# -ge 4 ] || { echo "Usage: npm run board -- claim <agent> <branche> <zone>..." >&2; exit 1; }
    agent=$2 branch=$3
    shift 3
    zones="$*"
    locked write_claim
    cat "$board"
    ;;
  release)
    [ $# -eq 2 ] || { echo "Usage: npm run board -- release <branche>" >&2; exit 1; }
    branch=$2
    locked write_release
    ;;
  *)
    echo "Usage: npm run board [-- list | claim <agent> <branche> <zone>... | release <branche>]" >&2
    exit 1
    ;;
esac
