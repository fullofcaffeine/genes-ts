# Official Haxe active inventory

This fixture records the official Haxe tests that register for each Genes
JavaScript profile. It does not compile the tests with Genes or run them.

The inventory contains 1,373 test methods for each profile:

- 250 methods from the main unit classes.
- 67 methods from generated standard-library specifications.
- 1,056 methods from issue-regression classes.

The classic and TypeScript inventories must contain the same identities. A
profile difference stops the command.

## Source authority

[`manifest.json`](manifest.json) pins these source revisions:

- Haxe 4.3.7 at `e0b355c6be312c1b17382603f018cf52522ec651`.
- utest at `a94f8812e8786f2b5fec52ce9f26927591d26327`.
- hxnodejs 12.2.0 at `c9450595b2337587bcdaeacf159019531925f25d`.

Haxe and utest own the test source and registration rules. The hxnodejs pin is
an inventory dependency. Haxe needs its extern types to type `TestHttp` under
the `nodejs` define. This pin does not add a runtime claim.

The runner fetches each exact revision into an ignored cache. It does not copy
the upstream test corpus into this repository.

## How the inventory works

The runner compiles upstream `unit.TestMain` with `--no-output`. It uses the
defines from the selected profile and the options from the upstream JS unit
build.

Haxe resolves conditional compilation before the inventory macro runs. Haxe
also expands the macros that register specification tests and issue tests.

The inventory macro reads the typed `unit.TestMain.main` expression. It records
each constructed `utest.ITest` class and each active `test` or `spec` method.
The macro does not execute a test method.

## Commands

Make sure that the selected Haxe compiler is version 4.3.7. Then run:

```bash
yarn test:official-haxe-inventory
```

The command generates both profiles and compares them with the reviewed JSON
files in [`inventories`](inventories). It stops for a source, registration,
profile, count, family, capability, or exclusion difference.

If a reviewed upstream change is intentional, generate new files:

```bash
yarn inventory:official-haxe
```

Review the complete JSON difference. Also review every change to a pin,
profile define, capability rule, exclusion, count, and source identity.

## Capability policy and exclusions

The manifest names requirements that later runtime work must provide. These
requirements include resources, a writable filesystem, loopback sockets, and
the official HTTP echo server.

The manifest also names inactive upstream source. It includes the commented
`TestUnspecified` registration and every disabled issue or specification file.
The runner stops if one of these sources becomes active without review.

This inventory is input for the representative runtime work in
`genes-brxy.3`. A green inventory is not a Genes compatibility result and does
not increase the six-test smoke claim.
