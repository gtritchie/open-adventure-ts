# Core Release Guide

This project publishes `@open-adventure/core` release artifacts from Git tags via GitHub Actions. Each tag push uploads the packed tarball to the GitHub Release and publishes it to the npm registry with package provenance.

## Prerequisites (one-time)

The workflow authenticates with npm via [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC), so there is no long-lived token to manage. These steps run once, total.

1. **Confirm npm org membership.** The maintainer must be an owner of the `open-adventure` npm organization.
2. **Bootstrap publish from a developer machine (one-time).** npm requires the package to exist before a Trusted Publisher can be configured for it. Publish `v1.0.1` once, from your local machine, to claim the package on the registry:

   ```bash
   npm login                                  # interactive; uses your npm account
   git checkout v1.0.1
   pnpm install --frozen-lockfile
   pnpm --filter @open-adventure/core build
   mkdir -p .release
   pnpm --filter @open-adventure/core pack --pack-destination .release
   npm publish .release/open-adventure-core-1.0.1.tgz --access public
   git checkout main
   ```

   This bootstrap version is published without provenance; every subsequent version goes through the workflow and carries a provenance attestation.
3. **Configure Trusted Publishing on npm.** In npm's web UI, navigate to the package page → Settings → Trusted Publisher → add a GitHub Actions publisher with:
   - Repository owner: `gtritchie`
   - Repository name: `open-adventure-ts`
   - Workflow filename: `release-core.yml`
   - Environment: leave blank

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

# 3) Push commit and the new tag (replace vX.Y.Z with the tag the script created)
git push
git push origin vX.Y.Z
```

Pushing only the new tag (instead of `git push --tags`) avoids publishing any unrelated local tags.

`scripts/release-core.sh` runs `npm version <bump> --no-git-tag-version` inside `packages/core` to update only `package.json`, then creates the release commit and tag itself. The script drives git directly because npm's built-in tagging is unreliable in this layout: the root `package.json` has no `workspaces` field (pnpm uses `pnpm-workspace.yaml`), and running `pnpm --filter ... exec npm version ...` can leave npm thinking it isn't in a git repo (`Not tagging: not in a git repo or no git cmd`), bumping the version without committing or tagging.

## Examples

```bash
# Minor release bump
scripts/release-core.sh minor

# Set an exact version
scripts/release-core.sh 1.2.3
```

## Post-Push Verification

After pushing, confirm:

- The new tag format is `vX.Y.Z`.
- `packages/core/package.json` version matches the tag version.
- GitHub Actions started `Release Core Package` from the tag push.
- The GitHub Release for that tag has the core `.tgz` attached.
- `npm view @open-adventure/core version` returns the new version.
- `https://www.npmjs.com/package/@open-adventure/core/v/X.Y.Z` shows a "Provenance" badge linking back to the workflow run.
