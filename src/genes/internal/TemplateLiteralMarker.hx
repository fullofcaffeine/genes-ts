package genes.internal;

/**
 * Typed carrier consumed by Genes template-literal planning and emission.
 *
 * The extern declaration gives Haxe an exact `Array<String>` protocol without
 * creating a runtime value. Reachable calls are validated and erased by Genes;
 * seeing this member in generated output is always a compiler defect.
 */
@:noCompletion
extern class TemplateLiteralMarker {
  public static function __emit(chunks: Array<String>,
    values: Array<String>): String;
}
