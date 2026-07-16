# Compiler-internal top-level type evidence

This fixture proves that `@:genes.compilerInternal` is an output-projection
contract, not an early erasure rule.

The Haxe source deliberately constructs and switches over a private generic
enum. Haxe typing and full DCE must therefore retain its implementation. At the
final Genes output boundary, both compiler profiles keep that enum local while
omitting its ESM export, classic declaration, public Haxe enum registration,
and source-map interval. A public class immediately after the enum proves that
source mapping resumes normally.

The same source also contains ordinary private and public secondary types.
Those are regression controls, not a new privacy policy. Some real Haxe
libraries route public signatures through source-private helpers, so this
change intentionally leaves their existing output behavior untouched until a
separate public-type accessibility design can normalize those signatures.

`yarn test:internal-types` runs:

- request-free standard Haxe JavaScript;
- classic Genes ESM plus strict external `.d.ts` consumption;
- genes-ts source through TypeScript 5.5, 6, and 7; and
- runtime, export, registry, declaration, and source-map assertions.

This is the visibility prerequisite for typed ts2hx `try/finally` completion
records. It does not by itself claim any new ts2hx control-flow support.
