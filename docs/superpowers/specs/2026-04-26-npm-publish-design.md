# Publishing `@open-adventure/core` to npm

Status: Approved
Date: 2026-04-26

## Summary

Extend the existing `release-core.yml` workflow so that a `v*` tag push also
publishes the packed `@open-adventure/core` tarball to the public npm registry
with provenance, in addition to the existing GitHub Release upload. No new
workflow file, no new job — just additional steps in the existing job, plus
documentation updates and a one-time npm/GitHub-secret setup.

## Goals

- One tag push, one release everywhere: tag `vX.Y.Z` produces a GitHub Release
  *and* an npm release for `@open-adventure/core@X.Y.Z`.
- The artifact published to npm is byte-identical to the artifact attached to
  the GitHub Release (publish the same packed `.tgz`).
- Releases carry npm package provenance (signed attestation of the GitHub
  Actions run that produced them).
- `workflow_dispatch` runs remain safe for diagnostics: they do not publish to
  npm or update the GitHub Release unless the operator opts in.

## Non-goals

- Publishing any package other than `@open-adventure/core` (the `cli` package
  is out of scope for this change).
- Backfilling the existing `v1.0.1` GitHub Release to npm. The next version
  bump is the first version that lands on npm.
- Auto-generating release notes (already in place).

## Current state

`@open-adventure/core` v1.0.1 is published as a GitHub Release with the packed
tarball attached. The release flow is:

1. Maintainer runs `scripts/release-core.sh <bump>` locally — bumps
   `packages/core/package.json`, creates the release commit, creates the
   `vX.Y.Z` tag.
2. Maintainer pushes the commit and the tag.
3. Tag push triggers `.github/workflows/release-core.yml`, which builds and
   packs `@open-adventure/core` and uploads the tarball to the GitHub Release.

The npm `@open-adventure` org has been created but no token is configured and
nothing has ever been published to the registry.

## Design

### Workflow changes (`.github/workflows/release-core.yml`)

1. **Permissions** — add `id-token: write` to the job's `permissions` block
   (required for OIDC-signed npm provenance). `contents: write` remains.
2. **Inputs** — add a `publish_to_npm` boolean input to `workflow_dispatch`,
   default `false`, mirroring the existing `upload_release_asset` flag.
3. **`actions/setup-node`** — add `registry-url: 'https://registry.npmjs.org'`
   so `npm publish` picks up `NODE_AUTH_TOKEN` automatically. Keep
   `cache: pnpm` and `node-version: 24`.
4. **Checkout `ref` condition** — extend the existing expression so that
   *either* write-side input causes the workflow to check out `inputs.tag`
   instead of `github.sha`. Without this, a manual dispatch with
   `publish_to_npm: true` and `upload_release_asset: false` would build from
   the dispatching branch's HEAD and fail the existing tag/version validation
   step (or, worse, publish a tarball that does not correspond to the
   requested tag). New expression:

   ```yaml
   ref: ${{ github.event_name == 'workflow_dispatch' && ((inputs.upload_release_asset || inputs.publish_to_npm) && inputs.tag || github.sha) || github.ref }}
   ```

   The semantics: tag-push uses `github.ref` (the tag); a `workflow_dispatch`
   with any write-side input true uses `inputs.tag`; a fully-defaulted
   diagnostic dispatch uses `github.sha`.
5. **New step: "Publish to npm"** — placed *between* the pack step and the
   GitHub Release upload step:

   ```yaml
   - name: Publish to npm
     if: github.event_name == 'push' || inputs.publish_to_npm
     env:
       NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
     run: npm publish "${{ steps.pack_core.outputs.tarball }}" --provenance --access public
   ```

   Publishing the exact tarball produced by `pnpm pack` guarantees the artifact
   on npm matches the one attached to the GitHub Release byte-for-byte.
   `--access public` is redundant with `publishConfig.access: "public"` in
   `package.json` but is explicit at the publish site.

### Final step ordering

Build → Pack → Upload workflow artifact → **Publish to npm** → Upload to
GitHub Release.

Rationale for npm-before-GitHub-Release:

- If `npm publish` fails (auth, network, version already exists), the GitHub
  Release upload is skipped. The whole flow is retriable on the next tag.
- If we did the reverse and `npm publish` failed, we would have a GitHub
  Release for a version that does not exist on npm — a worse half-state.

### Trigger semantics

| Event                                            | Pack | Upload artifact | Publish to npm | Upload to GitHub Release |
| ------------------------------------------------ | :--: | :-------------: | :------------: | :----------------------: |
| `push` of `v*` tag                               |  ✓   |        ✓        |       ✓        |            ✓             |
| `workflow_dispatch`, both inputs `false`         |  ✓   |        ✓        |       ✗        |            ✗             |
| `workflow_dispatch`, `publish_to_npm: true`      |  ✓   |        ✓        |       ✓        |            ✗             |
| `workflow_dispatch`, `upload_release_asset: true`|  ✓   |        ✓        |       ✗        |            ✓             |

The default-`false` inputs preserve the existing diagnostic-rerun safety:
operators can re-run the workflow against any commit without accidentally
publishing or updating a GitHub Release.

### One-time setup (manual)

These steps happen outside the repo, once, before the next release.

1. **npm org membership** — confirm the maintainer's npm user is an owner of
   the `open-adventure` organization.
2. **Create a granular access token** on npm:
   - Type: **Granular Access Token**.
   - Permissions: **Read and write**.
   - Packages and scopes: limited to `@open-adventure/*`.
   - Expiration: 1 year, with a calendar reminder to rotate.
3. **Add the GitHub secret**: in the repository, navigate to Settings →
   Secrets and variables → Actions → New repository secret. Name `NPM_TOKEN`,
   value = the token from step 2.

These steps are documented in `docs/release.md` (see below).

### Documentation updates (`docs/release.md`)

- Add a "Prerequisites (one-time)" section covering the three setup steps
  above.
- Update "Post-Push Verification" to also confirm:
  - `https://www.npmjs.com/package/@open-adventure/core` shows the new
    version.
  - The version page displays a "Provenance" badge.
  - `npm view @open-adventure/core version` returns the new version.
- Add a short "Token rotation" note: the `NPM_TOKEN` secret expires; rotate
  before expiry by repeating one-time setup steps 2 and 3.

### Existing `v1.0.1` tag

The `v1.0.1` GitHub Release predates npm publishing. We do not backfill it.
The next version bump (`v1.0.2`, `v1.1.0`, or whatever the maintainer chooses)
is the first version to land on npm. The npm version history will start at
that version; the GitHub Releases page retains the full history.

## Risks and mitigations

| Risk                                                   | Mitigation                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `NPM_TOKEN` leaked from logs                           | Use `secrets.NPM_TOKEN` (masked by Actions). Never `echo` the token. `npm publish` never logs the token. |
| Version already exists on npm (re-run on same tag)     | `npm publish` fails with a clear `403`/`409`. Workflow fails loudly; no GitHub Release update.          |
| Tag/version mismatch                                   | Existing "Resolve and validate release tag" step already enforces tag = `package.json` version.         |
| Provenance signing flake                               | Job-level retry is not added; flakes are retriable via re-running the workflow on the same tag.         |
| Token expiry surprises a release                       | Rotation note in `docs/release.md`; calendar reminder set when the token is created.                    |
| `workflow_dispatch` accidentally publishing            | `publish_to_npm` input defaults to `false`; user must explicitly opt in.                                |

## Verification

- The next real tag push publishes both to GitHub Releases and to npm, and
  the npm package page shows a provenance badge.
- Before that, the workflow change can be exercised with a `workflow_dispatch`
  run using the defaults (`publish_to_npm: false`,
  `upload_release_asset: false`) — pack and artifact upload run, neither write
  side runs.
- Optional sanity: run `actionlint` on the modified workflow file locally.

## Out of scope (future work)

- Publishing the `cli` package to npm (separate decision; CLI distribution
  may also include alternatives like binary builds).
- Auto-creating GitHub Issues from npm advisories or audit signals.
- Multi-maintainer publish access (single-maintainer NPM_TOKEN today is fine).
