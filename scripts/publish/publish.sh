#!/usr/bin/env bash
#
# Publish forked @vlcn.io packages to npm.codemyriad.io under unique versions.
#
# Usage:
#   ./scripts/publish/publish.sh dev
#   MYRIAD_N=1 ./scripts/publish/publish.sh myriad
#
# Environment variables:
#   DRY_RUN=true    Stamp and check versions but skip publish
#   MYRIAD_N=1      Required for the "myriad" track
#
# Prerequisites:
#   - pnpm, npm, jq, git available on PATH
#   - registry auth configured outside the repo
#   - deps/cr-sqlite and deps/wa-sqlite submodules initialized
#   - build already completed for packages that need generated output

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=./config.sh
source "$SCRIPT_DIR/config.sh"

usage() {
  echo "Usage: $0 <dev|myriad>" >&2
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: required command '$cmd' is not available" >&2
    exit 1
  fi
}

pkg_name() {
  echo "${1%%:*}"
}

pkg_dir() {
  echo "$REPO_ROOT/${1##*:}"
}

require_cmd git
require_cmd jq
require_cmd npm
require_cmd pnpm

TRACK="${1:-}"
if [[ -z "$TRACK" ]]; then
  usage
  exit 1
fi

case "$TRACK" in
  dev|myriad)
    ;;
  *)
    echo "Error: track must be 'dev' or 'myriad', got '$TRACK'" >&2
    usage
    exit 1
    ;;
esac

for required_pkg in "$REPO_ROOT/deps/cr-sqlite/core/package.json" "$REPO_ROOT/deps/wa-sqlite/package.json"; do
  if [[ ! -f "$required_pkg" ]]; then
    echo "Error: missing $required_pkg. Run 'git submodule update --init --recursive' first." >&2
    exit 1
  fi
done

DRY_RUN="${DRY_RUN:-false}"
SHORT_SHA="$(git -C "$REPO_ROOT" rev-parse --short=8 HEAD)"

case "$TRACK" in
  dev)
    DATE_STAMP="$(date -u +%Y%m%d)"
    VERSION_SUFFIX="dev.${DATE_STAMP}.${SHORT_SHA}"
    DIST_TAG="$DEV_DIST_TAG"
    ;;
  myriad)
    if [[ -z "${MYRIAD_N:-}" ]]; then
      echo "Error: MYRIAD_N must be set for the myriad track" >&2
      exit 1
    fi
    VERSION_SUFFIX="myriad.${MYRIAD_N}"
    DIST_TAG="$MYRIAD_DIST_TAG"
    ;;
esac

WORKTREE_STATE="$(git -C "$REPO_ROOT" status --short --ignore-submodules=none)"
if [[ -n "$WORKTREE_STATE" ]]; then
  echo "Warning: worktree is not clean before stamping versions:" >&2
  echo "$WORKTREE_STATE" >&2
  echo "Publishing will still use commit SHA $SHORT_SHA. Make sure that is intentional." >&2
  echo "" >&2
fi

echo "==> Track: $TRACK"
echo "==> Version suffix: $VERSION_SUFFIX"
echo "==> Source SHA: $SHORT_SHA"
echo "==> Registry: $REGISTRY_URL"
echo "==> Dist tag: $DIST_TAG"
echo "==> Dry run: $DRY_RUN"
echo ""

stamp_version() {
  local pkg_json="$1"
  local base_version
  local new_version
  base_version="$(jq -r '.version' "$pkg_json")"
  new_version="${base_version}-${VERSION_SUFFIX}"
  jq --arg v "$new_version" '.version = $v' "$pkg_json" > "${pkg_json}.tmp"
  mv "${pkg_json}.tmp" "$pkg_json"
  echo "$new_version"
}

check_registry() {
  local name="$1"
  local version="$2"
  if npm view "${name}@${version}" version --registry "$REGISTRY_URL" >/dev/null 2>&1; then
    echo "Error: ${name}@${version} already exists on ${REGISTRY_URL}" >&2
    return 1
  fi
}

STAMPED_FILES=()
BACKUP_FILES=()
BACKUP_DIR="$(mktemp -d)"

cleanup() {
  if [[ ${#STAMPED_FILES[@]} -gt 0 ]]; then
    echo ""
    echo "==> Restoring package.json files..."
    for i in "${!STAMPED_FILES[@]}"; do
      cp "${BACKUP_FILES[$i]}" "${STAMPED_FILES[$i]}"
    done
  fi

  if [[ -d "$BACKUP_DIR" ]]; then
    rm -rf "$BACKUP_DIR"
  fi
}
trap cleanup EXIT

declare -A VERSION_MAP

echo "==> Stamping versions..."
for entry in "${PUBLISH_PACKAGES[@]}"; do
  name="$(pkg_name "$entry")"
  dir="$(pkg_dir "$entry")"
  pkg_json="$dir/package.json"

  if [[ ! -f "$pkg_json" ]]; then
    echo "Error: $pkg_json not found" >&2
    exit 1
  fi

  backup_path="$BACKUP_DIR/$(printf '%03d.json' "${#STAMPED_FILES[@]}")"
  cp "$pkg_json" "$backup_path"

  new_version="$(stamp_version "$pkg_json")"
  VERSION_MAP["$name"]="$new_version"
  STAMPED_FILES+=("$pkg_json")
  BACKUP_FILES+=("$backup_path")

  echo "  ${name}@${new_version}"
done

echo ""
echo "==> Checking registry for existing versions..."
for entry in "${PUBLISH_PACKAGES[@]}"; do
  name="$(pkg_name "$entry")"
  version="${VERSION_MAP[$name]}"

  check_registry "$name" "$version"
  echo "  ${name}@${version} - available"
done

echo ""
if [[ "$DRY_RUN" == "true" ]]; then
  echo "==> DRY RUN: skipping publish"
  for entry in "${PUBLISH_PACKAGES[@]}"; do
    name="$(pkg_name "$entry")"
    dir="$(pkg_dir "$entry")"
    echo "  Would publish ${name}@${VERSION_MAP[$name]} from $dir"
  done
  exit 0
fi

echo "==> Publishing..."
for entry in "${PUBLISH_PACKAGES[@]}"; do
  name="$(pkg_name "$entry")"
  dir="$(pkg_dir "$entry")"
  version="${VERSION_MAP[$name]}"

  echo "  Publishing ${name}@${version}..."
  pnpm publish "$dir" \
    --registry "$REGISTRY_URL" \
    --tag "$DIST_TAG" \
    --no-git-checks
done

echo ""
echo "==> Done"
