#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_DIR="$ROOT_DIR/packages/core"

BUMP="${1:-patch}"

cd "$ROOT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required but not found in PATH." >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: must run inside a git repository." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: git working tree is not clean. Commit or stash changes first." >&2
  git status --short
  exit 1
fi

echo "Bumping @open-adventure/core with: npm version $BUMP"
VERSION_OUTPUT="$(cd "$CORE_DIR" && npm version "$BUMP")"
NEW_TAG="$(printf '%s\n' "$VERSION_OUTPUT" | tail -n 1)"

if [[ -z "$NEW_TAG" ]]; then
  echo "Error: npm version did not output a new tag/version." >&2
  exit 1
fi

if ! git rev-parse -q --verify "refs/tags/$NEW_TAG" >/dev/null; then
  echo "Error: expected tag '$NEW_TAG' was not created." >&2
  echo "Check npm output and git state before retrying." >&2
  exit 1
fi

if ! git diff-tree --no-commit-id --name-only -r HEAD | rg -q '^packages/core/package\.json$'; then
  echo "Error: HEAD does not include packages/core/package.json version bump." >&2
  exit 1
fi

echo
echo "Release bump succeeded:"
echo "  Tag: $NEW_TAG"
echo "  Commit: $(git rev-parse --short HEAD)"
echo
echo "Next:"
echo "  git push"
echo "  git push origin $NEW_TAG"
