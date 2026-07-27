package template_late;

import genes.internal.TemplateLiteralMarker;

/**
 * Names a same-module type only through a retained public signature.
 *
 * Haxe's runtime-oriented DCE omits `ZLateTemplate` from the module's initial
 * implementation inventory. Genes later materializes it from this TypeScript
 * type edge, which is the lifecycle boundary under test.
 */
class ZLateOwner {
  public function new() {}

  public function lateValue():Null<ZLateTemplate> {
    return null;
  }
}

/**
 * Contains malformed compiler-carrier data in a type added after the module's
 * first template plan was built.
 */
class ZLateTemplate {
  public function new() {}

  /**
   * `@:keep` is enabled only by the negative build. It tells Haxe DCE to retain
   * this otherwise unused executable body, which also makes the malformed
   * marker visible to Genes' initial template plan.
   */
  #if late_template_keep_marker
  @:keep
  #end
  public function malformed():String {
    return TemplateLiteralMarker.__emit(["head"], ["value"]);
  }
}
