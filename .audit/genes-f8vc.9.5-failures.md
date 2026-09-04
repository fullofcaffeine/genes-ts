# Acceptance process fixture timing failures

Exact compiler branch before the prerequisite: `47a4c67a4899f535a2fd702dc9326f8c89e1f306`.

`yarn test:acceptance-process-owner` failed twice unchanged under repository-required background priority and once in hosted CI run `33837298128`, job `100912823563`:

```text
AssertionError: Zombie-only status was trusted after one scan
```

The first test-only attempt changed the zombie fixture's total grace from 100 ms to 1,000 ms and its per-probe budget from 100 ms to the production default of 250 ms. The zombie control then passed, but two consecutive focused runs reached and failed a later independent control:

```text
AssertionError: false !== true
at test-acceptance-process-owner.js:749
```

That assertion is `existsSync(drainMarker) === true` in the drain-before-write fixture. A second test-only attempt changed its deliberately stalled console deadline from 100 ms to 1,000 ms and adjusted the matching error and elapsed-time expectations. The next run passed both earlier controls but reached another independent failure:

```text
AssertionError: true !== false
at test-acceptance-process-owner.js:774
```

That assertion is `ordinaryEscalationState.cleanup.probeDegraded === false`. The fixture gives each spawned Node process probe 50 ms.

No production code has been changed. The two current uncommitted edits are limited to fixture timing values in `scripts/test-acceptance-process-owner.ts`.
