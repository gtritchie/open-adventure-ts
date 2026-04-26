# Core Release Guide

This project publishes `@open-adventure/core` release artifacts from Git tags via GitHub Actions.

## Recommended Release Sequence

```bash
# 0) Start clean and current
git checkout main
git pull --ff-only
git status --short

# 1) Bump core version with npm from the package directory.
# This MUST be run in packages/core so npm can perform git commit+tag.
cd packages/core
npm version patch
cd ../..

# 2) Verify what was created
git log --oneline -1
git tag --list --sort=-creatordate | head -n 5

# 3) If step 1 did NOT create a release commit+tag, stop and debug before pushing.
#    (replace X.Y.Z with the new core version)
git status --short
git tag --list "vX.Y.Z"

# 4) Push commit and tags
git push
git push --tags
```

Do not use `pnpm --filter @open-adventure/core exec npm version ...` for releases: under pnpm exec, npm can skip git tagging/committing (`Not tagging: not in a git repo or no git cmd`) and only edit `package.json`.

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
