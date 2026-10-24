#!/bin/sh
# Shared board of work in progress for every worktree of this clone.
# Stored in the common git directory: visible from each worktree, never committed.
set -eu
board="$(git rev-parse --git-common-dir)/agents-board.tsv"
touch "$board"
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
    grep -v "	$branch	" "$board" > "$board.tmp" || true
    printf '%s\t%s\t%s\t%s\n' "$agent" "$branch" "$*" "$(date '+%Y-%m-%d %H:%M')" >> "$board.tmp"
    mv "$board.tmp" "$board"
    cat "$board"
    ;;
  release)
    [ $# -eq 2 ] || { echo "Usage: npm run board -- release <branche>" >&2; exit 1; }
    grep -v "	$2	" "$board" > "$board.tmp" || true
    mv "$board.tmp" "$board"
    ;;
  *)
    echo "Usage: npm run board [-- list | claim <agent> <branche> <zone>... | release <branche>]" >&2
    exit 1
    ;;
esac
