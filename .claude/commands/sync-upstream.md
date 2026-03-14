# Sync Upstream

@description Check the original C open-adventure project for new commits, evaluate relevance to this TypeScript port, and plan any needed changes.

You are syncing this TypeScript port of Open Adventure against the
original C project at `../open-adventure`.

## 1. Read current sync state

Read `upstream-sync.md` in the repo root to get the last reviewed
commit hash.

## 2. Fetch latest upstream commits

Run `git -C ../open-adventure fetch origin` to ensure the local copy
is up to date, then run
`git -C ../open-adventure log --oneline <last-commit>..HEAD` to list
all new commits since the last reviewed commit.

If there are no new commits, report that the upstream is already in
sync and skip to step 5 (still update the sync file with today's
date).

## 3. Analyze each commit

For every new upstream commit, examine its diff:
`git -C ../open-adventure show <hash>`

Classify each commit into one of these categories:

- **Relevant** — Changes to game logic, data, output text, or
  behavior that would affect byte-identical output. These MUST be
  ported. Use the C-to-TypeScript source mapping from CLAUDE.md to
  identify which TS files are affected.
- **Data-only** — Changes to `adventure.yaml` or dungeon generation.
  These may need `pnpm generate` to be re-run, or manual YAML edits.
- **Irrelevant** — Changes to build system, CI, C-specific code
  (Makefile, .c/.h refactors with no logic change), documentation,
  or tooling that has no equivalent in the TS port.

For each commit, state:
- The commit hash and subject line
- The category
- A brief rationale for the classification
- For relevant/data-only commits: which TypeScript files need changes
  and what the changes should be

## 4. Output the sync plan

Summarize findings:
- Total new commits examined
- How many are relevant, data-only, and irrelevant
- For all relevant and data-only commits, provide a concrete action
  plan describing what needs to change in the TypeScript port, with
  file:line references where possible
- If no commits are relevant, state that no changes are needed

## 5. Update upstream-sync.md

Regardless of whether any changes are needed, update
`upstream-sync.md` to record the latest upstream commit hash and
today's date. Use the HEAD commit of the upstream repo:
`git -C ../open-adventure rev-parse --short HEAD`

Do NOT commit the change — leave it as an unstaged modification.
