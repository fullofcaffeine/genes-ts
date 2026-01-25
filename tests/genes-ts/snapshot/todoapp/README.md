# todoapp snapshot

This snapshot case asserts the **generated TypeScript/TSX** for the `examples/todoapp` project.

Source of truth for the Haxe program lives at:

- `examples/todoapp/src`

This snapshot only commits the parts of the generated output that represent the **todoapp user modules**
(`todo/**`) plus the entrypoint (`index.ts` / `index.tsx`), to avoid duplicating the full stdlib/runtime
in the snapshot.

