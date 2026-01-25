# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Beads sync branch (keep `main` clean)

The exported issue database `.beads/issues.jsonl` is **not tracked on `main`** to avoid
constant “sync” commits. The canonical tracked copy lives on the `beads-sync` branch.

- Normal dev on `main`: use `bd` as usual; the JSONL file may update locally but is ignored.
- If you want to publish issue updates: switch to the `beads-sync` worktree/branch and push that.

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

## Documentation quality (hxdoc)

For **vital or complex** code (compiler internals, runtime helpers, macros, harness/test infrastructure):

This repo should be a **world-class reference** for how to build and maintain a
real compiler/codegen pipeline in Haxe.

- Use **hxdoc** (`/** ... */`) and write it **didactically** with **Why / What / How**.
- Be explicit about the **compiler contract**:
  - inputs/outputs, determinism requirements, file layout, import policy,
  - compatibility assumptions (Node/TS/Haxe versions), and
  - the two output modes (classic JS vs TS source output).
- Prefer documenting the *contract* (inputs/outputs/side effects), invariants, and edge cases over restating obvious code.
- When a decision is non-obvious, document the **tradeoff** (why we chose it and what we rejected).
- Include examples when it clarifies non-obvious behavior (short snippets are fine).

### Required hxdoc for advanced Haxe features

If you use intermediate/advanced Haxe features, add comprehensive hxdoc that explains:

- **Why** the feature is used (what problem it solves here)
- **What** it expands to / what it guarantees
- **How** it interacts with typing/codegen and what pitfalls exist

Examples of “advanced” constructs that should be documented when used:

- macros (`macro`, `haxe.macro.*`, reification/quoting/splicing, `Context.*`)
- codegen/emitters that depend on typing subtleties (e.g. `Null<T>`, abstracts, enum abstracts, overloads, type/value namespaces)
- `@:build` / `@:autoBuild`, `@:generic`, `@:using`, `@:forward`, `@:from`/`@:to`, `@:native`, `@:jsRequire`
- JS interop boundaries (`js.Syntax.code`, externs) and any runtime reflection hooks

Keep trivial helpers undocumented unless they hide important constraints.

## Generated TS typing policy (no `any` / `unknown`)

- Generated TypeScript should be **idiomatic and strongly typed**.
- Avoid emitting `any` / `unknown` in **user modules**.
- `any` / `unknown` is only acceptable in a **small runtime boundary** (e.g. `genes/Register.ts`) and only when:
  - the behavior is inherently dynamic (reflection registry, prototype mutation, raw JS interop), and
  - there is no practical alternative.
- When `any` / `unknown` is used in runtime code, include a short comment explaining **why**.

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
