#!/usr/bin/env sh
set -eu

root=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$root" ]; then
  echo >&2 "genes-beads: run this command inside the Genes Git repository"
  exit 1
fi

common=$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)
binary="$common/genes-tools/bd"
"$root/scripts/beads/verify-pinned.sh" "$binary"
exec "$binary" "$@"
