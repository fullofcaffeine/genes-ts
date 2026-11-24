# Named records passed to nullable parameters

A record can be passed directly to a parameter that accepts the same record
or `null`. Previously, Genes emitted an unnecessary `Register.unsafeCast` for
this call:

```haxe
typedef Review = {final values:Array<String>; final ?fingerprint:String;}
static function accept(?review:Review):Int;
static function forward(request:{final review:Review}):Int
  return accept(request.review);
```

The widening check followed the typedef into its anonymous body before the
existing boundary comparator could establish the named type's identity.
The fix preserves that identity for the comparison. It does not introduce
general structural assignment checking.

Run `node tests/genes-ts/repros/nullable-record-widening/check.mjs` with the
repository Haxe toolchain on `PATH`. The main TypeScript acceptance harness
also runs this fixture.

The independent TypeScript consumers check direct assignment, omitted optional
fields, rejection of explicit `undefined`, and rejection of a nullable value
where a record is required. A macro checks that unrelated and nested-nullable
generic arguments do not qualify as outer widening. Both generated runtimes
check record identity, direct and explicit-local calls, one-time evaluation,
and the omitted-parameter default.

The output observer forbids the redundant helper in this fixture. Removing
the helper removes its runtime call; this is a structural cost observation,
not a compile-time or runtime latency benchmark.
