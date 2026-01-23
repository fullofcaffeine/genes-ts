# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Output modes (keep both green)

genes-ts intentionally supports **two output modes** within the same library:

1) **TypeScript source output** (genes-ts mode): enabled by `-D genes.ts`
2) **Classic Genes JS output** (ESM + optional `.d.ts`): default when `-D genes.ts` is not set

Both modes should remain well-maintained and share as much implementation as practical.

## Type safety (no `untyped` / no `Dynamic`)

In **framework + test code** (including the todoapp harness), avoid:

- `untyped`
- `Dynamic` (and other "escape hatches" that erase types)

Prefer small, well-typed externs/abstracts and keep any unavoidable JS interop confined to a narrow boundary (e.g. `extern` modules or a single wrapper).

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Key Commands

```bash
# Classic Genes JS mode (baseline)
npm test

# genes-ts TypeScript output mode
npm run test:genes-ts
npm run test:genes-ts:minimal
npm run test:genes-ts:full
npm run test:genes-ts:tsx

# Output stability + sourcemaps
npm run test:genes-ts:snapshots
npm run test:genes-ts:sourcemaps

# Full acceptance (compiler + todoapp E2E)
npm run test:acceptance

# Todoapp E2E only
npm run test:todoapp:e2e

# Example build (TS output)
npm run build:example:genes-ts
npm run build:example:todoapp
```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
