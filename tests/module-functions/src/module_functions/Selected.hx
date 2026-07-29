package module_functions;

import haxe.Rest;
import genes.ts.Undefinable;
import js.lib.Promise;
import module_function_invalid.ImportedBinding;

typedef Labelled = {
  var label: String;
}

/**
 * Keeps an enum constructor called `Ready` in the same generated module as the
 * selected method below.
 *
 * A Haxe enum constructor is emitted as `ConstructorNameControl.Ready`, not as
 * a standalone module variable. The module function may therefore safely use
 * the top-level name `Ready`; this fixture prevents collision planning from
 * confusing an object member with a real module binding.
 */
enum ConstructorNameControl {
  Ready;
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

  /**
   * Publishes the genuine generic module function without a wrapper.
   *
   * The exact same function value remains available through
   * `Selected.publicIdentity` for Haxe callers and through the stable
   * `publicIdentity` ESM binding for native callers.
   */
  @:expose("publicIdentity")
  @:genes.moduleFunction("publicIdentity")
  public static function publicIdentity<T: Labelled>(value: T): T {
    return value;
  }

  /** Proves zero-argument `@:expose` uses the retained Haxe field name. */
  @:expose
  @:genes.moduleFunction("publicByFieldName")
  public static function publicByFieldName(value: Int): Int {
    return value + 1;
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

  /**
   * Proves the compiler-owned presence marker is safe after relocation.
   *
   * The assertion removes only outer `undefined`; a present nested Haxe
   * `null` remains part of both the generated TypeScript type and runtime
   * value. The marker itself has no class-lexical dependency.
   */
  @:genes.moduleFunction("safePresentModuleFunction")
  public static function safePresent(value: Undefinable<Null<String>>): Null<String> {
    if (Undefinable.isAbsent(value))
      return null;
    return value.assumePresent();
  }

  /** Proves Haxe's typed Array.map allocation stays valid after relocation. */
  @:genes.moduleFunction("mapValuesModuleFunction")
  public static function mapValues(values: Array<Int>): Array<Int> {
    return values.map(value -> value + 1);
  }

  /** Proves enum members do not reserve unrelated module-level names. */
  @:genes.moduleFunction("Ready")
  public static function enumConstructorName(value: Int): Int {
    return value + 5;
  }

  /**
   * Proves the private descriptor overload contains types but no default value.
   *
   * The real module function still owns `= null`, so ordinary Haxe default
   * argument behavior is unchanged. TypeScript forbids an initializer on the
   * bodyless overload signature that preserves the public static method type.
   */
  @:genes.moduleFunction("nullableDefaultModuleFunction")
  public static function nullableDefault(value: Null<String> = null): String {
    return value == null ? "missing" : value;
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
