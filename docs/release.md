# Core Release Guide

This project publishes `@open-adventure/core` release artifacts from Git tags via GitHub Actions. Each tag push uploads the packed tarball to the GitHub Release and publishes it to the npm registry with package provenance.

## Prerequisites (one-time)

These steps are needed once before the first npm release, and again whenever the npm token expires.

1. **Confirm npm org membership.** The maintainer must be an owner of the `open-adventure` npm organization.
2. **Create a granular npm access token.** In npm's web UI, under Access Tokens, create a new **Granular Access Token**:
   - Permissions: **Read and write**.
   - Packages and scopes: limited to `@open-adventure/*`.
   - Expiration: 1 year. Set a calendar reminder to rotate before it expires.
3. **Add the token as a GitHub repository secret.** In the repository, go to Settings → Secrets and variables → Actions → New repository secret. Name it `NPM_TOKEN` and paste the token value from step 2.

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

`scripts/release-core.sh` runs `npm version <bump> --no-git-tag-version` inside `packages/core` to update only `package.json`, then creates the release commit and tag itself. The script drives git directly because npm's built-in tagging is unreliable in this layout: the root `package.json` has no `workspaces` field (pnpm uses `pnpm-workspace.yaml`), and running `pnpm --filter ... exec npm version ...` can leave npm thinking it isn't in a git repo (`Not tagging: not in a git repo or no git cmd`), bumping the version without committing or tagging.

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
