# React 19 Flight values

Genes provides a framework-neutral, versioned type vocabulary for values that
React 19 Flight can transport. It also provides a macro-time validator that a
React host can reuse without moving host lifecycle or security policy into the
compiler.

This is not a Server Component framework, router, RPC layer, or runtime codec.
Next.js, a Gutenberg host, or another React integration still owns the boundary
that creates and transports values.

## Why this lives in Genes

React's transport algebra is useful outside Next.js. Duplicating the recursive
type walk in each Haxe React host would create subtly different rules for
arrays, records, `undefined`, maps, sets, symbols, and nested values. Genes owns
that reusable language/React contract; host projects own only their
framework-specific provenance and diagnostics.

The version is part of the package path:

```haxe
import genes.react.flight.v19.FlightDate;
import genes.react.flight.v19.FlightGlobalSymbol;
import genes.react.flight.v19.FlightMap;
import genes.react.flight.v19.FlightSet;
```

These types preserve their native JavaScript identities. For example,
`FlightMap<K, V>` emits `Map<K, V>`, `FlightDate` emits `Date`, and
`FlightGlobalSymbol.forKey("app.marker")` emits `Symbol.for("app.marker")`.
There is no Genes Flight runtime or wrapper allocation.

`FlightGlobalSymbol` can project one way to `js.lib.Symbol` for ordinary native
interop, and `key()` emits `Symbol.keyFor(value)`. The reverse conversion is
intentionally absent: a local or otherwise unproven raw symbol must not forge
global-registry provenance.

`FlightMap` retains the familiar native Map API, including construction,
`size`, `has`, `get`, `set`, deletion, clearing, callbacks, and key/value/entry
iteration. Its deliberate improvement over Haxe 4.3.7's `js.lib.Map` extern is
that `get` returns `Undefinable<V>`: JavaScript returns `undefined` for a
missing key, not a nullable value. The runtime remains the same native Map.

## Closed value algebra

`FlightValueValidation.validateFlightValue(...)` accepts:

- `String`, `Bool`, `Int`, and `Float`;
- primitive-represented Haxe abstracts, including string, number, and boolean
  enum abstracts;
- `genes.react.Node` and `genes.react.Element`;
- arrays and closed anonymous records, checked recursively;
- `Null<T>` and `genes.ts.Undefinable<T>`;
- the exact React 19 capabilities under `genes.react.flight.v19`: dates,
  array buffers, typed arrays, maps, sets, and global-registry symbols.

It rejects broad or unresolved values, raw Promises, raw symbols, ordinary
functions, class instances, runtime Haxe enums, and recursive value graphs.
Raw `js.lib.Date`, `Map`, `Set`, `ArrayBuffer`, and typed-array declarations
are also rejected: sharing a runtime representation does not implicitly opt a
type into this versioned transport contract. Use the corresponding
`genes.react.flight.v19` capability when the host boundary supports it.
The result is either `null` or a `FlightValidationIssue` containing a stable
closed reason kind, the exact path, rejected Haxe type, explanation, and
deepest available source position. Genes does not choose a host's diagnostic
code or terminate compilation.

## Host-proven extensions

Some valid React values require provenance that shape alone cannot prove. A
framework may, for example, guarantee that a nominal resource is module-stable
or that a callable came from its reviewed server-function generator.

The optional `FlightExtensionPolicy` is deliberately closed:

- `Accept` accepts one nominal host capability;
- `Recurse` asks Genes to validate named nested payload types;
- `Reject` supplies a host-specific reason;
- `Unhandled` leaves the type to Genes' conservative rejection.

Genes invokes the policy only for unknown nominal class or abstract types. It
never invokes it for raw Promise, Symbol, function, broad, or unresolved
shapes. A callback therefore cannot turn structural resemblance into trusted
provenance. Empty recursion requests and recursive host-capability graphs fail
closed instead of becoming implicit acceptance or overflowing the macro walk.

```haxe
function hostPolicy(
  type:haxe.macro.Type,
  path:String
):FlightExtensionDecision {
  return switch type {
    case TAbstract(reference, parameters)
        if (reference.get().module == "my_host.StableResource"
          && parameters.length == 1):
      Recurse([{
        type: parameters[0],
        path: path + ".resolved",
        position: null
      }]);
    case _:
      Unhandled;
  }
}
```

The host remains responsible for proving how `StableResource<T>` is created,
where it may be used, and which runtime owns it. Genes only validates `T`.

## Evidence

Run:

```bash
yarn test:react-flight
```

The fixture compiles the same non-Next React host through TypeScript and classic
JavaScript profiles, checks TypeScript 5.5/current/API lanes, executes the
classic runtime, verifies native `Map` and `Symbol.for` output, checks
determinism and source maps, and exercises negative controls for every rejected
family. It separately proves that a `FlightGlobalSymbol` projects to a native
symbol while the reverse assignment fails during Haxe typing and publishes no
output. Raw native Date, collection, buffer, and typed-array controls prove
that only the explicit versioned capability names enter the accepted algebra.
Host extension controls also attempt to accept raw Promise, Symbol, and
function shapes; Genes rejects them before consulting the extension.
