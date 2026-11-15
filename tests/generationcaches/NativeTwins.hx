package tests.generationcaches;

/**
 * Extern declarations that Haxe renames to shared names before generation.
 * `GenerationCachesProbe` reads them; no test calls them and they emit
 * nothing.
 */
@:keep @:native("ProbeTwin") extern class TwinPlain {
  static function make<T>(value: T): T;
  static function other(): Void;
}

@:keep @:native("ProbeTwin") extern class TwinAnnotated {
  @:ts.explicitTypeArguments
  static function make<T>(value: T): T;
  static function plain(): Void;
  @:ts.explicitTypeArguments
  static function over<T>(value: T): Array<T>;
}

@:keep @:native("probe.a.Factory") extern class FactoryPlain {
  static function build<T>(value: T): T;
}

@:keep @:native("probe.b.Factory") extern class FactoryAnnotated {
  @:ts.explicitTypeArguments
  static function build<T>(value: T): T;
}
