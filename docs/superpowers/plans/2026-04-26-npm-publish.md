# npm Publish for `@open-adventure/core` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `release-core.yml` workflow so a `v*` tag push publishes the packed `@open-adventure/core` tarball to the npm registry with provenance, in addition to the existing GitHub Release upload. Authentication uses npm's Trusted Publishing (OIDC); no long-lived secret is stored in the repository.

**Architecture:** All changes live in two files: `.github/workflows/release-core.yml` (workflow logic) and `docs/release.md` (operator documentation). Workflow changes add a permission, a `workflow_dispatch` input, an `npm publish` step, and adjust the checkout ref expression. The same packed tarball produced by `pnpm pack` is what gets published to npm — no second build path. Both provenance signing and Trusted Publishing rely on the workflow's OIDC token, gated by `id-token: write`.

**Tech Stack:** GitHub Actions, Node.js 24 (with bundled npm), `softprops/action-gh-release@v2`, `actions/setup-node@v4`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-26-npm-publish-design.md`

---

## Pre-flight notes for the implementer

- Work on the existing branch `npm-publish-design`. Do not commit directly to `main`.
- The npm-side setup (bootstrap publish of `v1.0.1`, configuring the Trusted Publisher) is **the maintainer's responsibility, done outside this plan**. The plan only documents that work in `docs/release.md`. Do not attempt to publish or configure npm from the agent.
- The implementation cannot be end-to-end tested without the bootstrap publish and Trusted Publisher being configured on npm. Verification in this plan is limited to static checks (`actionlint`) and reading the rendered workflow YAML.
- After each task, commit. The repo CLAUDE.md mandates per-turn commits to keep roborev review scopes tight.

## File structure

| File | Change | Responsibility |
| --- | --- | --- |
| `.github/workflows/release-core.yml` | Modify | Add `id-token: write` permission, `publish_to_npm` input, updated checkout ref, and a new `Publish to npm` step that authenticates via Trusted Publishing. |
| `docs/release.md` | Modify | Document one-time Trusted Publishing setup (including bootstrap publish) and expand post-push verification. |
| `docs/superpowers/specs/2026-04-26-npm-publish-design.md` | (Already committed) | Approved design spec. Reference only. |

No new files are created. No code outside `.github/workflows/` and `docs/` changes.

---

## Task 1: Add `id-token: write` permission

**Files:**
- Modify: `.github/workflows/release-core.yml:19-20`

**Why:** Both npm provenance signing and npm's Trusted Publishing OIDC exchange require the workflow job to mint an OIDC token. Without `id-token: write`, both `npm publish --provenance` and the Trusted Publishing token exchange fail with permissions errors.

- [ ] **Step 1: Edit the permissions block**

Find:
```yaml
permissions:
  contents: write
```

Replace with:
```yaml
permissions:
  contents: write
  id-token: write
```

- [ ] **Step 2: Run actionlint to verify YAML is well-formed**

Run: `actionlint .github/workflows/release-core.yml`
Expected: no output (success). Any output = failure to fix before continuing.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release-core.yml
git commit -m "Grant id-token write permission to release-core workflow"
```

---

## Task 2: Add `publish_to_npm` workflow_dispatch input

**Files:**
- Modify: `.github/workflows/release-core.yml:7-17`

**Why:** Manual `workflow_dispatch` runs default to safe (no writes). A new boolean input lets the operator opt in to publishing without also publishing to GitHub Releases.

- [ ] **Step 1: Add the new input under `workflow_dispatch.inputs`**

Find:
```yaml
      upload_release_asset:
        description: "Upload the built .tgz to GitHub Release"
        required: true
        default: false
        type: boolean
```

Replace with:
```yaml
      upload_release_asset:
        description: "Upload the built .tgz to GitHub Release"
        required: true
        default: false
        type: boolean
      publish_to_npm:
        description: "Publish the built .tgz to the npm registry"
        required: true
        default: false
        type: boolean
```

- [ ] **Step 2: Run actionlint**

Run: `actionlint .github/workflows/release-core.yml`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release-core.yml
git commit -m "Add publish_to_npm workflow_dispatch input"
```

---

## Task 3: Extend checkout ref expression to honor `publish_to_npm`

**Files:**
- Modify: `.github/workflows/release-core.yml:31`

**Why:** Without this, a manual dispatch with `publish_to_npm: true` and `upload_release_asset: false` would build from the dispatching branch's HEAD instead of the requested tag, and the existing tag/version validation step would fail. (This is the issue caught by roborev review #437.) The fix: any write-side input causes a tag checkout.

- [ ] **Step 1: Edit the `ref:` line under the `Checkout` step**

Find:
```yaml
          ref: ${{ github.event_name == 'workflow_dispatch' && (inputs.upload_release_asset && inputs.tag || github.sha) || github.ref }}
```

Replace with:
```yaml
          ref: ${{ github.event_name == 'workflow_dispatch' && ((inputs.upload_release_asset || inputs.publish_to_npm) && inputs.tag || github.sha) || github.ref }}
```

- [ ] **Step 2: Run actionlint**

Run: `actionlint .github/workflows/release-core.yml`
Expected: no output.

- [ ] **Step 3: Trace the expression by hand**

Walk through each event/input combination and confirm the expected ref:

| Event | `upload_release_asset` | `publish_to_npm` | Expected ref |
| --- | --- | --- | --- |
| push | n/a | n/a | `github.ref` (the tag) |
| dispatch | false | false | `github.sha` (diagnostic) |
| dispatch | true | false | `inputs.tag` |
| dispatch | false | true | `inputs.tag` |
| dispatch | true | true | `inputs.tag` |

If any case does not match, the expression is wrong — fix it before committing.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release-core.yml
git commit -m "Check out tag for any write-side workflow_dispatch input"
```

---

## Task 4: Add the `Publish to npm` step

**Files:**
- Modify: `.github/workflows/release-core.yml` — insert between the existing `Upload packaged core as workflow artifact` step and the existing `Upload tarball to GitHub Release` step.

**Why:** This is the actual publish action. It:
- Runs only on tag push or when `publish_to_npm` is true on a manual dispatch.
- Publishes the *exact* tarball produced by `pnpm pack` so the artifact on npm is byte-identical to the GitHub Release attachment.
- Adds `--provenance` to mint a signed attestation linking the artifact to this workflow run.
- Authenticates via Trusted Publishing — `npm publish` detects the GitHub Actions OIDC environment (made available by `id-token: write` from Task 1) and exchanges the workflow's OIDC token for a short-lived publish credential at the npm registry. No `NODE_AUTH_TOKEN`, no `.npmrc`, no `registry-url`.
- Runs **before** the GitHub Release upload, so a publish failure aborts the flow without creating a half-state.
- Uses the `TARBALL` env-var indirection rather than inline `${{ }}` interpolation in `run:`, following GitHub's workflow-injection guidance.

- [ ] **Step 1: Insert the new step**

Find:
```yaml
      - name: Upload packaged core as workflow artifact
        uses: actions/upload-artifact@v4
        with:
          name: core-package-tarball
          path: ${{ steps.pack_core.outputs.tarball }}

      - name: Upload tarball to GitHub Release
```

Replace with:
```yaml
      - name: Upload packaged core as workflow artifact
        uses: actions/upload-artifact@v4
        with:
          name: core-package-tarball
          path: ${{ steps.pack_core.outputs.tarball }}

      - name: Publish to npm
        if: github.event_name == 'push' || inputs.publish_to_npm
        env:
          TARBALL: ${{ steps.pack_core.outputs.tarball }}
        run: npm publish "$TARBALL" --provenance --access public

      - name: Upload tarball to GitHub Release
```

- [ ] **Step 2: Run actionlint**

Run: `actionlint .github/workflows/release-core.yml`
Expected: no output.

- [ ] **Step 3: Sanity-check the rendered file**

Read the workflow file end-to-end. Confirm:
- The `Publish to npm` step appears between the workflow-artifact upload and the GitHub Release upload (not before the pack step, not after the release upload).
- `if:` condition matches the spec: `github.event_name == 'push' || inputs.publish_to_npm`.
- `${{ steps.pack_core.outputs.tarball }}` references the same output the GitHub Release upload uses (consistent artifact).
- No `NODE_AUTH_TOKEN`, no `secrets.NPM_TOKEN`, no `registry-url` setting on `setup-node` — Trusted Publishing requires none of these.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release-core.yml
git commit -m "Publish core tarball to npm with provenance on tag push"
```

---

## Task 5: Document the one-time Trusted Publishing setup in `docs/release.md`

**Files:**
- Modify: `docs/release.md` — insert a new section between the existing intro paragraph and `## Recommended Release Sequence`.

**Why:** Two pieces of out-of-repo state must exist before the workflow can publish: the package must be on npm (Trusted Publishing requires the package to exist), and a Trusted Publisher entry on npm must point at this workflow. The current document mentions neither.

- [ ] **Step 1: Insert the prerequisites section**

Find:
```markdown
# Core Release Guide

This project publishes `@open-adventure/core` release artifacts from Git tags via GitHub Actions.

## Recommended Release Sequence
```

Replace with:
```markdown
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
```

- [ ] **Step 2: Verify the rendered Markdown**

Read `docs/release.md` end-to-end. Confirm:
- The new section sits between the intro and `## Recommended Release Sequence`.
- The intro paragraph mentions npm registry publication.
- All three numbered prerequisites appear and are unambiguous.

- [ ] **Step 3: Commit**

```bash
git add docs/release.md
git commit -m "Document one-time Trusted Publishing setup in release guide"
```

---

## Task 6: Expand `docs/release.md` post-push verification

**Files:**
- Modify: `docs/release.md` — the `## Post-Push Verification` section.

**Why:** After a release lands, the maintainer needs to confirm npm published successfully and provenance was attached. The current checklist only covers GitHub Releases.

- [ ] **Step 1: Update the verification list**

Find:
```markdown
## Post-Push Verification

After pushing, confirm:

- The new tag format is `vX.Y.Z`.
- `packages/core/package.json` version matches the tag version.
- GitHub Actions started `Release Core Package` from the tag push.
- The GitHub Release for that tag has the core `.tgz` attached.
```

Replace with:
```markdown
## Post-Push Verification

After pushing, confirm:

- The new tag format is `vX.Y.Z`.
- `packages/core/package.json` version matches the tag version.
- GitHub Actions started `Release Core Package` from the tag push.
- The GitHub Release for that tag has the core `.tgz` attached.
- `npm view @open-adventure/core version` returns the new version.
- `https://www.npmjs.com/package/@open-adventure/core/v/X.Y.Z` shows a "Provenance" badge linking back to the workflow run.
```

No "Token Rotation" section is needed — Trusted Publishing has no long-lived secret to rotate.

- [ ] **Step 2: Verify the rendered Markdown**

Read `docs/release.md` end-to-end. Confirm:
- Two new verification bullets cover npm version and provenance badge.
- No references to `NPM_TOKEN`, token rotation, or expiring secrets.

- [ ] **Step 3: Commit**

```bash
git add docs/release.md
git commit -m "Add npm verification to release post-push checklist"
```

---

## Task 7: Final verification pass

**Files:** none modified.

**Why:** Before opening the PR, run a single end-to-end static check and review the full diff.

- [ ] **Step 1: Run actionlint on all workflows**

Run: `actionlint`
Expected: no output (success).

- [ ] **Step 2: Review the full branch diff**

Run: `git diff main..HEAD -- .github/workflows/release-core.yml docs/release.md`
Read the diff in full. Confirm every change is intentional and matches the spec. If anything is surprising, fix before pushing.

- [ ] **Step 3: Confirm no incidental changes elsewhere**

Run: `git diff --name-only main..HEAD`
Expected output (in some order):
```
.github/workflows/release-core.yml
docs/release.md
docs/superpowers/plans/2026-04-26-npm-publish.md
docs/superpowers/specs/2026-04-26-npm-publish-design.md
```
Anything else means an incidental file was committed by mistake — investigate before pushing.

- [ ] **Step 4: Push and open a PR**

```bash
git push -u origin npm-publish-design
gh pr create --title "Publish @open-adventure/core to npm on tag push" --body "$(cat <<'EOF'
## Summary
- Extends the release workflow to publish the packed core tarball to npm with provenance on every `v*` tag push.
- Authentication uses npm Trusted Publishing (OIDC), so no `NPM_TOKEN` secret is stored in the repository.
- Adds a `publish_to_npm` boolean input to `workflow_dispatch` so manual runs can opt in.
- Documents the one-time Trusted Publishing setup (including bootstrap publish of v1.0.1) and post-push verification in `docs/release.md`.

## Test plan
- [ ] `actionlint` passes on the modified workflow.
- [ ] After merge: maintainer bootstraps v1.0.1 publish from local machine and configures the Trusted Publisher on npm.
- [ ] Manual `workflow_dispatch` run with both inputs `false` succeeds (build + pack only) and produces a workflow artifact tarball.
- [ ] First real tag push (`vX.Y.Z`) results in: GitHub Release with `.tgz` attached, `npm view @open-adventure/core version` returns the new version, and the npm version page shows a Provenance badge.
EOF
)"
```

---

## Self-review (already performed)

- **Spec coverage:** All four spec sections (Workflow changes, One-time setup, Documentation updates, Existing v1.0.1 tag) map to tasks: workflow change items 1–4 → Tasks 1–4; one-time setup → Task 5; documentation updates → Tasks 5 and 6; existing v1.0.1 → covered by the Task 5 bootstrap docs.
- **Placeholder scan:** No TBDs, no "add appropriate error handling", no "similar to Task N". Every code block is fully written.
- **Type consistency:** No types defined. The single workflow expression is consistent across Tasks 2 and 3 (`inputs.publish_to_npm` matches the input name added in Task 2). No secrets are referenced in the implementation. The tarball reference `steps.pack_core.outputs.tarball` matches the existing pack step's `id: pack_core` and output.
