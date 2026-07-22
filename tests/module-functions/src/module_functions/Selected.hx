package module_functions;

import haxe.Rest;
import genes.ts.Undefinable;
import js.lib.Promise;
import module_function_invalid.ImportedBinding;

typedef Labelled = {
  var label: String;
}

/** Positive controls for zero-wrapper module-function lowering. */
@:keep
class Selected {
  public static var initialized(default, null): String = selected({
    label: "static"
  }, "-init");
  public static var classInitialized(default, null): String;

  public static function before(): String {
    return "before";
  }

  /**
   * Emits as the unexported generic module function `useSemantic`.
   *
   * The class keeps a typed `Selected.selected` method descriptor, then Genes
   * assigns that property directly to `useSemantic`. Defaults and rest values
   * therefore execute only in the real function and are never duplicated by
   * the compiler-owned descriptor seed.
   */
  @:genes.moduleFunction("useSemantic")
  public static function selected<T: Labelled>(value: T, suffix = "!",
      rest: Rest<String>): String {
    return value.label + suffix + rest.length;
  }

  @:genes.moduleFunction("recursiveModuleFunction")
  public static function recursive(value: Int): Int {
    return value <= 0 ? 0 : 1 + recursive(value - 1);
  }

  /** Proves that the exact module binding may equal the Haxe field name. */
  @:genes.moduleFunction("sameName")
  public static function sameName(value: Int): Int {
    return value + 2;
  }

  @:genes.moduleFunction("crossBaseModuleFunction")
  public static function crossBase(value: Int): Int {
    return value + 10;
  }

  @:genes.moduleFunction("crossCallingModuleFunction")
  public static function callsCross(value: Int): Int {
    return CrossModule.selected(value);
  }

  @:genes.moduleFunction("privateCallingModuleFunction")
  public static function callsPrivate(value: Int): Int {
    return privateHelper(value);
  }

  @:genes.moduleFunction("localStaticModuleFunction")
  public static function localStatic(): Int {
    static var calls = 0;
    return ++calls;
  }

  /** Proves a known typed undefined helper is safe after relocation. */
  @:genes.moduleFunction("safeOptionalModuleFunction")
  public static function safeOptional(value: Undefinable<String>): Null<String> {
    return value.orNull();
  }

  /** Proves Haxe's typed Array.map allocation stays valid after relocation. */
  @:genes.moduleFunction("mapValuesModuleFunction")
  public static function mapValues(values:Array<Int>):Array<Int> {
    return values.map(value -> value + 1);
  }

  @:genes.moduleFunction("loadModuleValue")
  @:jsAsync
  public static function load(value: Int): Promise<Int> {
    return Promise.resolve(value + 1);
  }

  /** Proves requested module names and observable class properties are separate. */
  @:native("renamedSelected")
  @:genes.moduleFunction("moduleRenamed")
  public static function renamed(value: Int): Int {
    return value * 2;
  }

  public static function after(): String {
    return "after";
  }

  static function privateHelper(value: Int): Int {
    return value + 3;
  }

  static function __init__(): Void {
    classInitialized = selected({label: "class"}, "-init");
  }
}

/** Metadata is not a DCE root, even when the dead requested name would collide. */
class DeadSelected {
  @:genes.moduleFunction("Selected")
  public static function removed(): Int {
    return ImportedBinding.value();
  }
}

/** Proves stable planning for a second retained owner in the same module. */
@:keep
class SecondarySelected {
  @:genes.moduleFunction("secondaryModuleFunction")
  public static function selected(value: Int): Int {
    return value + 4;
  }
}
