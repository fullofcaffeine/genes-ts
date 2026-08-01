package genes.react.internal;

/**
 * Compile-only proof that one root JSX marker came from the HXX parser.
 *
 * The public marker signature needs a nominal value that application code
 * cannot obtain through the ordinary typed API. `JSX.jsx()` attaches Haxe's
 * explicit private-access permission only to this nested issuer reference. The
 * request-local JSX plan then checks the exact owner and field identity before
 * it authorizes source-only property-carrier cleanup.
 */
@:genes.compilerInternal
@:noCompletion
extern class HxxParserProof {
  private static function issue(): HxxParserProof;
}
