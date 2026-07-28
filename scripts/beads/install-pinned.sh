#!/usr/bin/env bash
set -euo pipefail

# This is an exact source pin, not the misleading upstream semantic-version
# string. The selected commit contains schema migration 0059 and the
# generalized NULL-history fix needed by the current Genes database.
readonly BEADS_VERSION="1.1.0"
readonly BEADS_COMMIT="7eb428cde13c6d2c4743a76533be8df2d418aff5"
readonly BEADS_ARCHIVE_SHA256="c2903ff26ca0554a1edf0551094ec4ce30ccfd1595aa746944633995f2801ec6"
readonly BEADS_ARCHIVE_URL="https://github.com/gastownhall/beads/archive/${BEADS_COMMIT}.tar.gz"
readonly BEADS_BUILD_LABEL="genes-pinned"

usage() {
  cat <<'USAGE'
Usage: scripts/beads/install-pinned.sh [--install-dir DIR] [--archive FILE]

Builds the exact Beads revision owned by Genes. By default the binary is
installed under Git's common directory so the primary checkout and every
linked worktree use one client for their one shared Dolt database.

--archive permits an already-downloaded source archive, but its SHA-256 is
still verified before extraction.
USAGE
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "[beads-install] ERROR: sha256sum or shasum is required." >&2
    return 1
  fi
}

repository_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repository_root" ]]; then
  echo "[beads-install] ERROR: run this command inside the Genes Git repository." >&2
  exit 1
fi

common_git_dir="$(git -C "$repository_root" rev-parse --path-format=absolute --git-common-dir)"
install_dir="$common_git_dir/genes-tools"
archive=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir)
      [[ $# -ge 2 ]] || {
        echo "[beads-install] ERROR: --install-dir requires a value." >&2
        exit 1
      }
      install_dir="$2"
      shift 2
      ;;
    --archive)
      [[ $# -ge 2 ]] || {
        echo "[beads-install] ERROR: --archive requires a value." >&2
        exit 1
      }
      archive="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[beads-install] ERROR: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v go >/dev/null 2>&1; then
  echo "[beads-install] ERROR: Go is required to build the pinned Beads source." >&2
  exit 1
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/genes-beads-install.XXXXXX")"
temporary_binary=""
cleanup() {
  rm -rf "$tmp_dir"
  if [[ -n "$temporary_binary" ]]; then
    rm -f "$temporary_binary"
  fi
}
trap cleanup EXIT

if [[ -z "$archive" ]]; then
  archive="$tmp_dir/beads.tar.gz"
  curl --fail --location --silent --show-error \
    "$BEADS_ARCHIVE_URL" \
    --output "$archive"
elif [[ ! -f "$archive" ]]; then
  echo "[beads-install] ERROR: archive does not exist: $archive" >&2
  exit 1
fi

actual_sha256="$(sha256_file "$archive")"
if [[ "$actual_sha256" != "$BEADS_ARCHIVE_SHA256" ]]; then
  echo "[beads-install] ERROR: checksum mismatch for the pinned Beads source." >&2
  echo "[beads-install] expected: $BEADS_ARCHIVE_SHA256" >&2
  echo "[beads-install] actual:   $actual_sha256" >&2
  exit 1
fi

tar -xzf "$archive" -C "$tmp_dir"
source_dir="$tmp_dir/beads-$BEADS_COMMIT"
migration="$source_dir/internal/storage/schema/migrations/0059_recompute_null_gate_is_blocked.up.sql"
if [[ ! -f "$migration" ]]; then
  echo "[beads-install] ERROR: verified source does not contain required schema migration 0059." >&2
  exit 1
fi

binary="$tmp_dir/bd"
(
  cd "$source_dir"
  CGO_ENABLED=1 GOFLAGS=-tags=gms_pure_go go build \
    -trimpath \
    -ldflags="-X main.Build=$BEADS_BUILD_LABEL -X main.Commit=$BEADS_COMMIT -X main.Branch=main" \
    -o "$binary" \
    ./cmd/bd
)

expected_version="bd version $BEADS_VERSION ($BEADS_BUILD_LABEL: main@${BEADS_COMMIT:0:12})"
reported_version="$("$binary" version 2>/dev/null | tr -d '\r\n')"
if [[ "$reported_version" != "$expected_version" ]]; then
  echo "[beads-install] ERROR: pinned binary reported an unexpected identity." >&2
  echo "[beads-install] expected: $expected_version" >&2
  echo "[beads-install] actual:   ${reported_version:-none}" >&2
  exit 1
fi

mkdir -p "$install_dir"
temporary_binary="$install_dir/bd.${$}.tmp"
install -m 0755 "$binary" "$temporary_binary"
mv -f "$temporary_binary" "$install_dir/bd"
temporary_binary=""

echo "[beads-install] Verified Beads source $BEADS_COMMIT ($BEADS_ARCHIVE_SHA256)"
echo "[beads-install] Installed $reported_version at $install_dir/bd"
