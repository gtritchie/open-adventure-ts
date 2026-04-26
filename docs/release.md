# Core Release Guide

This project publishes `@open-adventure/core` release artifacts from Git tags via GitHub Actions.

## Recommended Release Sequence

```bash
# 0) Start clean and current
git checkout main
git pull --ff-only
git status --short

# 1) Bump core version via helper script
# choose ONE of: patch | minor | major | <exact-version>
scripts/release-core.sh patch

# 2) Verify what was created
git log --oneline -1
git tag --list --sort=-creatordate | head -n 5

# 3) Push commit and tags
git push
git push --tags
```

`scripts/release-core.sh` runs `npm version` from `packages/core` and validates that both the release commit and tag were actually created. Do not use `pnpm --filter @open-adventure/core exec npm version ...` for releases: under pnpm exec, npm can skip git tagging/committing (`Not tagging: not in a git repo or no git cmd`) and only edit `package.json`.

## Examples

```bash
# Minor release bump
scripts/release-core.sh minor

# Set an exact version
scripts/release-core.sh 1.2.3
```

## Safer Single-Tag Push Variant

If you want to avoid pushing unrelated local tags, push only the new release tag:

```bash
git push origin vX.Y.Z
```

## Post-Push Verification

After pushing, confirm:

- The new tag format is `vX.Y.Z`.
- `packages/core/package.json` version matches the tag version.
- GitHub Actions started `Release Core Package` from the tag push.
- The GitHub Release for that tag has the core `.tgz` attached.
