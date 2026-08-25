package genes.internal;

#if genes.lexical_binding_inventory
/** Test-only typed carrier for lexical binding query evidence. */
@:noCompletion
@:genes.compilerInternal
extern class LexicalBindingQueryMarker {
  public static function mark(group: String, role: String,
    candidates: Array<String>): Void;
}
#end
