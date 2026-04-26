#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_DIR="$ROOT_DIR/packages/core"

BUMP="${1:-patch}"

# Restrict to bump kinds that npm version maps to a vX.Y.Z tag, matching the
# strict pattern enforced by .github/workflows/release-core.yml. Reject up
# front so we don't leave package.json mutated on a failed validation.
if [[ ! "$BUMP" =~ ^(patch|minor|major|[0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  echo "Error: bump must be one of: patch, minor, major, or an exact X.Y.Z. Got: '$BUMP'" >&2
  exit 1
fi

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

# Bump version in package.json only; do git operations ourselves below.
# npm's built-in git tagging is unreliable in pnpm workspaces (no `workspaces`
# field in root package.json), so we drive the commit and tag explicitly.
echo "Bumping @open-adventure/core with: npm version $BUMP --no-git-tag-version"
VERSION_OUTPUT="$(cd "$CORE_DIR" && npm version "$BUMP" --no-git-tag-version)"
NEW_TAG="$(printf '%s\n' "$VERSION_OUTPUT" | tail -n 1)"

# From here until the release commit lands, restore package.json on any
# non-zero exit so a mid-flight failure (tag collision, unexpected diff,
# etc.) doesn't leave the working tree dirty for the next run.
trap 'rc=$?; if [[ $rc -ne 0 ]]; then git checkout HEAD -- packages/core/package.json 2>/dev/null || true; fi' EXIT

if [[ -z "$NEW_TAG" ]]; then
  echo "Error: npm version did not output a new version." >&2
  exit 1
fi

if [[ ! "$NEW_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: unexpected version output from npm: '$NEW_TAG'" >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$NEW_TAG" >/dev/null; then
  echo "Error: tag '$NEW_TAG' already exists." >&2
  exit 1
fi

CHANGED="$(git diff --name-only)"
if [[ "$CHANGED" != "packages/core/package.json" ]]; then
  echo "Error: expected only packages/core/package.json to change, got:" >&2
  printf '%s\n' "$CHANGED" >&2
  exit 1
fi

git add packages/core/package.json
git commit -m "Release @open-adventure/core $NEW_TAG"
trap - EXIT
git tag "$NEW_TAG"

if ! git rev-parse -q --verify "refs/tags/$NEW_TAG" >/dev/null; then
  echo "Error: tag '$NEW_TAG' was not created." >&2
  exit 1
fi

if ! git diff-tree --no-commit-id --name-only -r HEAD | grep -q '^packages/core/package\.json$'; then
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
