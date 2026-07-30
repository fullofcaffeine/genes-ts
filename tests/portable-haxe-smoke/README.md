# Official Haxe smoke for both Genes profiles

This fixture runs five active tests selected from the official Haxe 4.3.7
suite at commit `e0b355c6be312c1b17382603f018cf52522ec651`:

- three methods from the shared language class `TestNumericSeparator`;
- one generated `unitstd` case from `IntIterator.unit.hx`; and
- issue regression `Issue10032`.

The exact same upstream source files are compiled once through classic Genes
ESM JavaScript and once through `-D genes.ts`. Classic output is syntax-checked
and executed directly. TypeScript output is checked with the pinned strict
TypeScript floor, compiled to JavaScript, and executed. The runner compares the
active utest identities and per-test assertion outcomes across profiles.
`manifest.json` pins the reviewed count for every test (`12`, `11`, `11`, `9`,
and `1`) as well as the 44-assertion profile total. This is intentionally
stricter than checking that every test ran: silently skipping one assertion in
both profiles must fail rather than look like equivalent success.

The selected files depend on utest's assertion API, but the complete historical
utest runner also brings in dynamic reporting and browser code unrelated to
these five language tests. This fixture therefore uses a small typed
`upstream-harness-adaptation`: it calls each selected official test method
directly, keeps the original assertion predicates, and fails if the selection
uses an assertion helper the adapter does not provide. `manifest.json` pins the
two upstream utest input hashes and all four local adapter hashes, so either
side changing requires an explicit review.

The repository does not copy the upstream corpus. The runner materializes the
two pinned Git revisions into an ignored cache, verifies commit identity and
the SHA-256 values in `manifest.json`, and preserves generated source, logs,
timings, and the machine result under `.tmp/test-evidence/portable-haxe-smoke/`.
`GENES_HAXE_SOURCE_REPOSITORY` and `GENES_UTEST_SOURCE_REPOSITORY` may point at
existing Git repositories; otherwise the runner uses the nearby `../haxe`
checkout when available and fetches the pinned public repositories as a
dependency-setup fallback.

Run:

```bash
yarn test:smoke
```

Successful evidence is published transactionally. An injected failure keeps a
separate diagnostic tree and cannot replace or partly modify the last
successful report. The smoke command exercises generation, JavaScript syntax,
strict TypeScript, module loading, assertions, runtime exceptions, a real Node
runtime timeout, publication rollback, missing-active-test failures, and a
missing-assertion-count failure.

This is intentionally an official-suite **smoke**, not a compatibility
percentage or full-suite claim. The broader active inventory and full
main/nightly/release lanes remain separately tracked work.
