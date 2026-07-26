package dynamicimportpolicy;

import genes.Genes;

/**
 * Exercises the legacy `Genes.dynamicImport()` helper with one local module.
 *
 * The helper runs while Haxe is typing this method, before Genes writes output
 * files. The focused test changes output profiles and extensions around this
 * same source so a stale or artifact-shaped suffix becomes directly visible.
 */
class Main {
  static function main(): Void {
    Genes.dynamicImport(Target -> {
      trace(Target.value());
    });
  }
}
