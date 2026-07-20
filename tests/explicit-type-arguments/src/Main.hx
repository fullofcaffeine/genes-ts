/**
 * Type-only projection of the fixture package's generic cell contract.
 *
 * Why: the package owns a TypeScript interface with no JavaScript constructor.
 * What: `$0` is genes-ts's placeholder for this Haxe type's first generic
 * argument, so `Cell<String>` prints as `import("./generic-cell.js").Cell<string>`.
 * How: the override affects TypeScript annotations only; the extern has no
 * emitted class or classic-JavaScript runtime representation.
 */
@:ts.type('import("./generic-cell.js").Cell<$0>')
private extern class Cell<Value> {
  final value: Value;
  function replace(value: Value): Void;
}

/** Type-only two-parameter projection used to prove ordered generic binding. */
@:ts.type('import("./generic-cell.js").Pair<$0, $1>')
private extern class Pair<Left, Right> {
  final left: Left;
  final right: Right;
}

/**
 * Closed Haxe witness for JavaScript's exact `undefined` type.
 *
 * The type override gives a no-argument extern overload a precise TypeScript
 * result without using `Dynamic`, `Any`, or Haxe nullability. It has no value
 * constructor and erases completely in classic JavaScript output.
 */
@:ts.type("undefined")
private extern class UndefinedValue {}

/** Precise bindings for the local, package-neutral generic fixture module. */
private extern class GenericCellModule {
  /**
   * Preserves the generic instantiation already selected by Haxe.
   *
   * Without this annotation TypeScript would independently infer `null` from
   * `makeCell(null)` and could widen a no-argument call from its exact Haxe
   * destination. genes-ts therefore emits `<Value>` immediately after the
   * imported function name. The call, arguments, and runtime order are
   * otherwise unchanged, and classic Genes ignores this TS-only annotation.
   */
  @:ts.explicitTypeArguments
  @:jsRequire("./generic-cell.js", "makeCell")
  @:overload(function(): Cell<UndefinedValue> {})
  static function makeCell<Value>(initial: Value): Cell<Value>;

  /** Ordinary generic extern retained as a control for native TS inference. */
  @:jsRequire("./generic-cell.js", "inferCell")
  static function inferCell<Value>(initial: Value): Cell<Value>;

  /** Two-parameter control proving declaration-order specialization. */
  @:ts.explicitTypeArguments
  @:jsRequire("./generic-cell.js", "makePair")
  static function makePair<Left, Right>(left: Left,
    right: Right): Pair<Left, Right>;
}

/** Exercises explicit and ordinary generic extern calls in one emitted file. */
class Main {
  static function preserveGeneric<Value>(value: Value): Cell<Value> {
    return GenericCellModule.makeCell(value);
  }

  static function main(): Void {
    final nullable: Cell<Null<String>> = GenericCellModule.makeCell(null);
    final absent: Cell<UndefinedValue> = GenericCellModule.makeCell();
    final inferred = GenericCellModule.inferCell(42);
    final pair: Pair<Null<String>, Bool> = GenericCellModule.makePair(null,
      true);

    nullable.replace("ready");
    absent.value;
    inferred.replace(43);
    pair.left;
    pair.right;
    preserveGeneric("generic").replace("still typed");
  }
}
