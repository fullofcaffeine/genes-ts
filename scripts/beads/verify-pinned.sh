#!/usr/bin/env sh
set -eu

expected='bd version 1.1.0 (genes-pinned: main@7eb428cde13c)'
binary=${1:-}

if [ -z "$binary" ]; then
  echo >&2 "genes-beads: internal error: verify-pinned.sh requires a binary path"
  exit 2
fi
if [ ! -x "$binary" ]; then
  echo >&2 "genes-beads: pinned client is not installed: $binary"
  echo >&2 "genes-beads: run: yarn beads:install"
  exit 1
fi

actual=$("$binary" version 2>/dev/null | tr -d '\r\n' || true)
if [ "$actual" != "$expected" ]; then
  echo >&2 "genes-beads: refusing an unverified Beads client"
  echo >&2 "genes-beads: expected: $expected"
  echo >&2 "genes-beads: actual:   ${actual:-unavailable}"
  echo >&2 "genes-beads: run: yarn beads:install"
  exit 1
fi
