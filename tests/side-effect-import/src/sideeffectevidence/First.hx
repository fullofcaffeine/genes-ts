package sideeffectevidence;

/** First converted-module analogue retained only through its typed anchor. */
class First {
  @:keep
  public static final initialized:Int = Events.values.push("first");

  /**
   * Proves a public typed anchor can retain initialization without becoming API.
   *
   * Why: a converted bare import has no source binding for Haxe DCE to follow.
   * What: this minimal token makes the module typeable from an importer; the
   * observable source initializer carries its own targeted `@:keep` because a
   * pure read inside this token can be optimized away before Genes runs.
   * How: `@:genes.compilerInternal` leaves the token visible to dependency
   * planning, then every implementation/declaration printer filters it.
   */
  @:keep
  @:noCompletion
  @:genes.compilerInternal
  public static final __ts2hxInit:Bool = true;
}
