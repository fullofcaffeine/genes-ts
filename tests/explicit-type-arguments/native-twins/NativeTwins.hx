/**
 * Two extern declarations of one native value in one Haxe module.
 *
 * Haxe renames a class that has `@:native("Lib")` to `Lib` before
 * generation. After that step `LibA` and `LibB` have the same module and the
 * same name. Only `LibB.make` asks for explicit type arguments.
 */
@:native("Lib") extern class LibA {
  /** Not annotated: TypeScript infers the type argument. */
  static function make<T>(value: T): T;

  static function other(): Void;
}

@:native("Lib") extern class LibB {
  /** Annotated: Genes prints the type argument that Haxe checked. */
  @:ts.explicitTypeArguments
  static function make<T>(value: T): T;

  static function plain(): Void;

  /** The no-argument overload has no annotation of its own. */
  @:ts.explicitTypeArguments
  @:overload(function(): Array<String> {})
  static function over<T>(value: T): Array<T>;
}

/**
 * Two extern declarations whose native names differ only in the package.
 * Haxe renames both classes to `Factory`.
 */
@:native("a.Factory") extern class FactoryA {
  static function build<T>(value: T): T;
}

@:native("b.Factory") extern class FactoryB {
  @:ts.explicitTypeArguments
  static function build<T>(value: T): T;

  static function ready(): Void;
}
