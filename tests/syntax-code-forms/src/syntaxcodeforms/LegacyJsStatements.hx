package syntaxcodeforms;

/**
 * `__js__` values that Genes does NOT print: Haxe's own printer still does.
 *
 * Why: Haxe rewrites ordinary code so that a statement never stands where a
 * value is expected. It does not rewrite the arguments of `__js__`. A value
 * can therefore be a `throw`, a loop, a `switch`, a block, a `try`, or a
 * function whose body was never rewritten. Genes' value printer is not built
 * for these, so `ExprEmitter.isPlainRawCodeValue` sends the whole call to
 * Haxe's printer, exactly as before Genes printed `__js__`.
 *
 * Each function below holds one such kind. `yarn test:syntax-code-forms`
 * checks that this module still equals the text that Haxe's printer produced
 * (`expected/`), that the printer-use report names this module, and that
 * every function runs.
 *
 * `untyped` is required because Haxe exposes `__js__` only to untyped code.
 */
class LegacyJsStatements {
  /** Throws for an empty text; returns its length otherwise. */
  static function measure(text: String): Int {
    if (text == "")
      throw "empty";
    return text.length;
  }

  /** Throws a text for 1, a number for 2, and returns 7 otherwise. */
  static function boom(kind: Int): Int {
    if (kind == 1)
      throw "text";
    if (kind == 2)
      throw 42;
    return 7;
  }

  // `throw` as the whole value.
  static function plainThrow(text: String): Int {
    return untyped __js__("{0} + 1", throw text);
  }

  // `throw` in one branch of a conditional.
  static function branchThrow(text: String): Int {
    return untyped __js__("{0} + 1",
      if (text.length > 1) text.length else throw "short");
  }

  // `switch` with a throwing default.
  static function switchThrow(choice: Int): Int {
    return untyped __js__("{0} + 1", switch choice {
      case 1: 10;
      case 2: 20;
      default: throw "bad";
    });
  }

  // `??` with a throwing right side.
  static function coalesceThrow(value: Null<Int>): Int {
    return untyped __js__("{0} + 1", value ?? throw "missing");
  }

  // `try` with a catch of every exception.
  static function anyCatch(text: String): Int {
    return untyped __js__("{0} + 1",
      try measure(text) catch (error:haxe.Exception) 40);
  }

  // `try` with a typed catch; Haxe turns it into a test and a rethrow.
  static function typedCatch(kind: Int): Int {
    return untyped __js__("{0} + 1",
      try boom(kind) catch (error:String) error.length);
  }

  // `while` loop.
  static function whileLoop(limit: Int): Int {
    var index = 0;
    untyped __js__("void {0}", while (index < limit) index++);
    return index;
  }

  // `do`/`while` loop.
  static function doWhileLoop(limit: Int): Int {
    var index = 0;
    untyped __js__("void {0}", do index++ while (index < limit));
    return index;
  }

  // `for` loop.
  static function forLoop(items: Array<Int>): Int {
    var total = 0;
    untyped __js__("void {0}", for (item in items) total += item);
    return total;
  }

  // Block with a local variable.
  static function blockValue(input: Int): Int {
    return untyped __js__("{0} + 1", {
      var doubled = input * 2;
      doubled;
    });
  }

  // `var` as the whole value.
  static function varValue(input: Int): Int {
    untyped __js__("void {0}", var unused = input);
    return input + 1;
  }

  // Function expressions.
  static function functionValue(input: Int): Int {
    final viaFunction: Int = untyped __js__("{0}()",
      function() return input + 1);
    final viaArrow: Int = untyped __js__("{0}()", () -> input + 2);
    return viaFunction * 10 + viaArrow;
  }

  static function attempt(call: () -> Int): String {
    return try Std.string(call()) catch (error:haxe.Exception) "thrown";
  }

  public static function run(): Array<String> {
    return [
      attempt(() -> plainThrow("x")),
      attempt(() -> branchThrow("long")),
      attempt(() -> branchThrow("s")),
      attempt(() -> switchThrow(2)),
      attempt(() -> switchThrow(3)),
      attempt(() -> coalesceThrow(5)),
      attempt(() -> coalesceThrow(null)),
      attempt(() -> anyCatch("six!")),
      attempt(() -> anyCatch("")),
      attempt(() -> typedCatch(0)),
      attempt(() -> typedCatch(1)),
      attempt(() -> typedCatch(2)),
      Std.string(whileLoop(3)),
      Std.string(doWhileLoop(3)),
      Std.string(forLoop([1, 2, 3])),
      Std.string(blockValue(4)),
      Std.string(varValue(4)),
      Std.string(functionValue(1))
    ];
  }
}
