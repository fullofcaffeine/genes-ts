# Beads (bd)

This repository uses **bd** (beads) for issue tracking during development.

Policy:
- `.beads/issues.jsonl` is tracked in git so a fresh checkout includes the roadmap.
- Local runtime state (`.beads/beads.db`, daemon logs, etc) is **not** tracked.
- This repo does not use a `beads-sync` branch.

If you want to use beads locally:
1) Install `bd`
2) Run `bd init` (or just start using `bd` and let it create the database)

Recommended: install `bd` git hooks locally so JSONL stays in sync:

```bash
bd hooks install
```
