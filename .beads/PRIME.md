# genes-ts: bd workflow context (in `genes` repo)

## Project goal (source of truth)

- Haxe→TypeScript compiler plan: `HAXE_TO_TYPESCRIPT_COMPILER_PLAN.md`
- Contract draft (M0): `docs/typescript-target/COMPILER_CONTRACT.md`

## What to work on next

- `bd ready`
- Epic: `genes-t6g`
- Next milestone: `genes-t6g.2` (blocks chain continues to `.8`)

## Minimal bd commands

```bash
bd ready
bd show <id>
bd update <id> --claim
bd close <id> --suggest-next
bd sync --flush-only
```

## Profiles/flags (compiler contract)

- Default: strict TS, Haxe-runtime compatibility, `.js` import specifiers, `Dynamic -> any`
- Opt-in: `genes.ts.no_extension`, `genes.ts.dynamic_unknown`, `genes.ts.minimal_runtime`
