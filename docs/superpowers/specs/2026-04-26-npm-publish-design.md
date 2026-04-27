# Publishing `@open-adventure/core` to npm

Status: Approved
Date: 2026-04-26

## Summary

Extend the existing `release-core.yml` workflow so that a `v*` tag push also
publishes the packed `@open-adventure/core` tarball to the public npm registry
with provenance, in addition to the existing GitHub Release upload. The
workflow authenticates via npm's Trusted Publishing (OIDC) — no long-lived
`NPM_TOKEN` secret is stored. No new workflow file, no new job; just
additional steps in the existing job, plus documentation updates and a
one-time bootstrap publish from a developer machine.

## Goals

- One tag push, one release everywhere: tag `vX.Y.Z` produces a GitHub Release
  *and* an npm release for `@open-adventure/core@X.Y.Z`.
- The artifact published to npm is byte-identical to the artifact attached to
  the GitHub Release (publish the same packed `.tgz`).
- Workflow-driven releases carry npm package provenance (signed attestation of
  the GitHub Actions run that produced them).
- No long-lived publish credentials stored as repository secrets.
  Authentication is short-lived OIDC, minted at publish time.
- `workflow_dispatch` runs remain safe for diagnostics: they do not publish to
  npm or update the GitHub Release unless the operator opts in.

## Non-goals

- Publishing any package other than `@open-adventure/core` (the `cli` package
  is out of scope for this change).
- Provenance on the bootstrap `v1.0.1` publish. Trusted Publishing requires the
  package to already exist on npm before a publisher can be configured, so the
  first version is published once from a developer laptop without provenance.
  Every subsequent version goes through the workflow with provenance.
- Auto-generating release notes (already in place).

## Current state

`@open-adventure/core` v1.0.1 exists as a GitHub Release with the packed
tarball attached but is **not** present on npm. The release flow is:

1. Maintainer runs `scripts/release-core.sh <bump>` locally — bumps
   `packages/core/package.json`, creates the release commit, creates the
   `vX.Y.Z` tag.
2. Maintainer pushes the commit and the tag.
3. Tag push triggers `.github/workflows/release-core.yml`, which builds and
   packs `@open-adventure/core` and uploads the tarball to the GitHub Release.

The npm `open-adventure` org has been created. No tokens or trusted publishers
are configured yet.

## Design

### Workflow changes (`.github/workflows/release-core.yml`)

1. **Permissions** — add `id-token: write` to the job's `permissions` block.
   This is required both for OIDC-signed npm provenance and for npm's Trusted
   Publishing OIDC exchange. `contents: write` remains.
2. **Inputs** — add a `publish_to_npm` boolean input to `workflow_dispatch`,
   default `false`, mirroring the existing `upload_release_asset` flag.
3. **Checkout `ref` condition** — extend the existing expression so that
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
4. **New step: "Publish to npm"** — placed *between* the workflow-artifact
   upload and the GitHub Release upload:

   ```yaml
   - name: Publish to npm
     if: github.event_name == 'push' || inputs.publish_to_npm
     env:
       TARBALL: ${{ steps.pack_core.outputs.tarball }}
     run: npm publish "$TARBALL" --provenance --access public
   ```

   `npm publish` detects the GitHub Actions OIDC environment (via the
   `id-token: write` permission) and exchanges the workflow's OIDC token for a
   short-lived publish credential at the npm registry — no `NODE_AUTH_TOKEN`
   or `.npmrc` configuration is required. Publishing the exact tarball
   produced by `pnpm pack` guarantees the artifact on npm matches the one
   attached to the GitHub Release byte-for-byte. `--access public` is
   redundant with `publishConfig.access: "public"` in `package.json` but is
   explicit at the publish site. The `TARBALL` env-var indirection follows
   GitHub's workflow-injection guidance for `${{ }}` expressions in `run:`.

### Final step ordering

Build → Pack → Upload workflow artifact → **Publish to npm** → Upload to
GitHub Release.

Rationale for npm-before-GitHub-Release:

- If `npm publish` fails (OIDC denied, version already exists, network), the
  GitHub Release upload is skipped. The whole flow is retriable on the next
  tag.
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

These steps happen outside the repo, once, before the workflow can publish to
npm. After this, no further credential setup or rotation is needed.

1. **Confirm npm org membership.** The maintainer's npm user must be an owner
   of the `open-adventure` organization.
2. **Bootstrap publish v1.0.1 from a developer machine.** npm requires the
   package to exist before a Trusted Publisher can be configured for it. The
   maintainer runs `npm login` interactively and publishes a packed v1.0.1
   tarball locally. This single bootstrap version lacks provenance; every
   later version goes through the workflow with provenance.
3. **Configure Trusted Publishing on npm.** On the package's settings page,
   add a GitHub Actions Trusted Publisher pointing at
   `gtritchie/open-adventure-ts`, workflow filename `release-core.yml`, no
   environment.

These steps are documented in `docs/release.md`.

### Documentation updates (`docs/release.md`)

- Replace the existing intro paragraph to mention npm registry publication.
- Add a "Prerequisites (one-time)" section covering the three setup steps
  above with concrete shell commands for the bootstrap publish.
- Update "Post-Push Verification" to also confirm:
  - `npm view @open-adventure/core version` returns the new version.
  - The version page on npm displays a "Provenance" badge linking back to the
    workflow run.

No "Token Rotation" section is needed — Trusted Publishing has no long-lived
secret to rotate.

### Existing `v1.0.1` tag

The `v1.0.1` GitHub Release predates npm publishing. Under Trusted Publishing,
the bootstrap publish (step 2 of one-time setup) publishes `v1.0.1` to npm
manually from a developer machine. After that, the package's version history
on npm starts at `v1.0.1`, matching the GitHub Releases history. The next
version bump (`v1.0.2` or later) is the first version to land on npm via the
workflow — and the first with provenance.

## Risks and mitigations

| Risk                                                   | Mitigation                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Trusted Publisher configuration drifts from workflow filename | If the workflow file is renamed, npm rejects the publish until the trusted publisher entry is updated. Documented in `docs/release.md`. |
| Version already exists on npm (re-run on same tag)     | `npm publish` fails with a clear `403`/`409`. Workflow fails loudly; no GitHub Release update.          |
| Tag/version mismatch                                   | Existing "Resolve and validate release tag" step already enforces tag = `package.json` version.         |
| Provenance signing flake                               | Job-level retry is not added; flakes are retriable via re-running the workflow on the same tag.         |
| OIDC outage at npm or GitHub                           | Manual recovery: maintainer can do a one-off local `npm publish` from the relevant tag. Rare event; not worth a fallback path in the workflow. |
| `workflow_dispatch` accidentally publishing            | `publish_to_npm` input defaults to `false`; user must explicitly opt in.                                |
| Bootstrap publish lacks provenance                     | One-time event affecting only `v1.0.1`. Acceptable trade-off for never storing a long-lived token.      |

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
- Pinning specific npm CLI versions in the workflow if Node.js's bundled npm
  ever drops below the minimum required for Trusted Publishing.
