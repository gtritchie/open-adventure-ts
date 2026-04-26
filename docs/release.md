# Core Release Guide

This project publishes `@open-adventure/core` release artifacts from Git tags via GitHub Actions.

## Safest Auto-Tag Sequence

```bash
# 0) Start clean and current
git checkout main
git pull --ff-only
git status --short

# 1) Bump core version and let pnpm create commit+tag
# choose ONE of: patch | minor | major | <exact-version>
pnpm --filter @open-adventure/core version patch

# 2) Verify what was created
git log --oneline -1
git tag --list --sort=-creatordate | head -n 5

# 3) Push commit and tags
git push
git push --tags
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
