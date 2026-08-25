package genes.internal;

/**
 * Carries one exact dynamic-import callback declaration through Haxe typing.
 *
 * The declaration body is still target syntax because it projects a loaded
 * namespace. Its versioned token independently authenticates the callback
 * local and export origin, so lexical planning can treat this one compiler
 * statement as a fixed binding without granting authored raw syntax the same
 * privilege. Genes removes the marker call before output.
 */
@:genes.compilerInternal
@:noCompletion
extern class DynamicBindingDeclarationMarker {
  public static function declare<Value>(token: String, value: Value): Value;
}
