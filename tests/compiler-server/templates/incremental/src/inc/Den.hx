package inc;

/**
 * Stage 3, slice S2: a module that stays clean while `inc.Leaf2` starts and
 * stops naming `DenNote` in a typedef field. The walk visits it first with
 * `Den` alone and, after `inc.Leaf2` adds `DenNote`, again with both; only
 * the second visit reaches `inc.DenDeep`, the superclass of `DenNote`.
 */
class Den {
  public static function value(): String {
    return "den";
  }
}

/**
 * Removed by dead-code elimination; the walk adds it late when a typedef
 * field names it (a local variable would make dead-code elimination keep it).
 */
class DenNote extends DenDeep {
  public function new() {
    super();
  }
}
