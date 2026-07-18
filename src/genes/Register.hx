package genes;

import haxe.DynamicAccess;
import js.lib.Object;
import js.Syntax;

class Register {
  @:keep @:native("$global")
  // `globalThis` is used as a dynamic registry in some parts of the JS runtime
  // (`$global["SomeClass"]`, etc), so we include a string index signature.
  @:ts.type("typeof globalThis & { [key: string]: unknown }")
  public static final _global = js.Syntax.code('globalThis');

  /**
   * The private index of global runtime registries (for example `$hxClasses`).
   *
   * Why: every JavaScript string is a valid registry name, including inherited
   * object keys such as `constructor`, `toString`, and `__proto__`.
   *
   * What: the index and each registry use null-prototype objects, so lookups
   * see only entries that Genes created. The Haxe type also records that this
   * outer dictionary stores `HxRegistry` values rather than arbitrary values.
   *
   * How: `Object.create(null)` produces a plain string-keyed dictionary with
   * no inherited properties. Keep this representation when changing registry
   * initialization; `{}` would silently reintroduce prototype-name collisions.
   */
  @:ts.type("{[key: string]: HxRegistry}")
  static final globals: DynamicAccess<HxRegistry> = nullPrototypeDictionary();
  @:keep @:native('new')
  @:ts.type("unique symbol")
  static final construct = new js.lib.Symbol();
  @:keep @:ts.type("unique symbol") static final init = new js.lib.Symbol();

  /**
   * Get (or lazily create) a named registry object on `globalThis`.
   *
   * This function is intentionally dynamic: the returned object is used for
   * heterogeneous registries like `$hxClasses` and `$hxEnums`.
   */
  @:ts.returnType("HxRegistry")
  @:keep public static function global(name: String): HxRegistry {
    final existing = globals.get(name);
    if (existing != null)
      return existing;
    final created: HxRegistry = nullPrototypeDictionary();
    globals.set(name, created);
    return created;
  }

  /**
   * Creates a typed string dictionary without JavaScript prototype members.
   *
   * Why: Haxe's `DynamicAccess` normally starts from `{}`, while Genes runtime
   * registries must accept every string without inheriting `Object` keys.
   *
   * What: callers receive an ordinary `DynamicAccess<T>` whose missing keys
   * return `null`, including `constructor`, `toString`, and `__proto__`.
   *
   * How: `NullPrototypeObject` supplies the null-accepting `Object.create`
   * overload missing from Haxe 4.3.7 but present in newer Haxe versions. The
   * private extern emits the native call directly, while this return type keeps
   * the dictionary generic and cast-free. No arbitrary object operation is
   * exposed through the compatibility bridge.
   */
  static inline function nullPrototypeDictionary<T>():DynamicAccess<T> {
    return NullPrototypeObject.createDictionary(null);
  }

  /**
   * Register a runtime type in the `$hxClasses` global registry.
   *
   * This is used by genes-ts output to keep Haxe/Genes reflection compatible
   * without emitting `(… as any)[…] = …` patterns into every generated module.
   */
  @:keep public static function setHxClass(id: String, value: js.lib.Function) {
    final hxClasses: HxRegistry = global("$hxClasses");
    Syntax.code('{0}[{1}] = {2}', hxClasses, id, value);
  }

  /**
   * Register a runtime enum in the `$hxEnums` global registry.
   *
   * This registry is used by `Type.resolveEnum(...)` and parts of the Haxe JS
   * runtime (e.g. `js.Boot.__string_rec`) to map enum names to their values.
   */
  @:keep public static function setHxEnum(id: String, value: js.lib.Function) {
    final hxEnums: HxRegistry = global("$hxEnums");
    Syntax.code('{0}[{1}] = {2}', hxEnums, id, value);
  }

  /**
   * Typed view of the `$hxClasses` registry (reflection).
   *
   * This keeps `Type.resolveClass(...)` and related code typed in generated TS
   * without leaking `unknown` into user modules.
   */
  @:keep @:ts.returnType("HxClasses")
  public static function hxClasses(): HxClasses {
    return unsafeCast(global("$hxClasses"));
  }

  /**
   * Typed view of the `$hxEnums` registry (reflection).
   *
   * This keeps enum reflection code typed in generated TS without leaking
   * `unknown` into user modules.
   */
  @:keep @:ts.returnType("HxEnums")
  public static function hxEnums(): HxEnums {
    return unsafeCast(global("$hxEnums"));
  }

  /**
   * Ensure an instance field exists on a class prototype for reflection
   * (`Type.getInstanceFields`, etc) without forcing a TS `any` cast.
   *
   * We intentionally set a `null` value (not `undefined`) to match Genes' legacy
   * behavior for uninitialized fields.
   */
  @:keep public static function seedProtoField(cls: js.lib.Function,
      name: String) {
    Object.defineProperty(Syntax.code('{0}.prototype', cls), name, {
      value: null,
      writable: true,
      enumerable: true,
      configurable: true
    });
  }

  /**
   * Unsafe type assertion helper.
   *
   * This is used by the TS emitter to keep `any` out of user modules when:
   * - metadata forces a TS type override (`@:genes.type`, `@:genes.returnType`)
   * - Haxe semantics rely on "impossible" states under TS types (e.g. some JS
   *   APIs return `undefined` but Haxe models `null`)
   *
   * It intentionally centralizes the unsafety inside the runtime boundary.
   */
  @:keep public static function unsafeCast<T>(value: Dynamic): T {
    return Syntax.code('{0}', value);
  }

  @:keep public static function createStatic<T>(obj: {}, name: String,
      get: Null<() -> T>) {
    var value: Null<T> = null;
    inline function init() {
      if (get != null) {
        value = get();
        get = null;
      }
    }
    Object.defineProperty(obj, name, {
      enumerable: true,
      get: () -> {
        init();
        return value;
      },
      set: v -> {
        init();
        value = v;
      }
    });
  }

  /**
   * NOTE: This function is intentionally typed as `any` in generated TS.
   *
   * In JS/Genes, dynamic field access to `.iterator` may refer to either:
   * - the Haxe/Genes iterator function (callable), OR
   * - an arbitrary user field value (non-callable), e.g. `{ iterator: 0 }`.
   *
   * Returning `any` preserves Genes semantics for dynamic field access while
   * keeping the unsafety confined to the runtime boundary.
   */
  @:keep @:ts.returnType("any")
  public static function iterator<T>(@:ts.type("Array<T> | { iterator: () => Iterator<T> } | { keys: () => Iterator<any>; get: (k: any) => T | null }") a: Dynamic): Void->Iterator<T> {
    return if (!(Syntax.code("Array.isArray({0})", a) : Bool)) {
      if ((Syntax.code('\"iterator\" in {0}', a) : Bool)) {
        js.Syntax.code('typeof {0}.iterator === \"function\" ? {0}.iterator.bind({0}) : {0}.iterator', a);
      } else {
        // Map-like fallback: iterate values via `keys()` + `get()`.
        () -> {
          final keys: Iterator<Dynamic> = a.keys();
          {
            hasNext: () -> keys.hasNext(),
            next: () -> unsafeCast(a.get(keys.next()))
          }
        }
      }
    } else {
      mkIter.bind((cast a : Array<T>));
    }
  }

  @:keep public static function getIterator<T>(@:ts.type("Array<T> | { iterator: () => Iterator<T> } | { keys: () => Iterator<any>; get: (k: any) => T | null }") a: Dynamic): Iterator<T> {
    return if (!(Syntax.code("Array.isArray({0})", a) : Bool)) {
      if ((Syntax.code('\"iterator\" in {0}', a) : Bool)) {
        js.Syntax.code('{0}.iterator()', a);
      } else {
        final keys: Iterator<Dynamic> = a.keys();
        {
          hasNext: () -> keys.hasNext(),
          next: () -> unsafeCast(a.get(keys.next()))
        }
      }
    } else {
      mkIter((cast a : Array<T>));
    }
  }

  @:keep static function mkIter<T>(a: Array<T>): Iterator<T> {
    return new ArrayIterator(a);
  }

  /**
   * Create a "synthetic" subclass constructor at runtime.
   *
   * genes-ts uses this to preserve Genes/Haxe JS inheritance semantics while
   * breaking module cycles. The return type is a broad constructor shape because
   * TS cannot express the precise constructor signature of the dynamically-computed
   * superclass.
   *
   * Why not just return `any`? TypeScript declaration emit looks at classes such
   * as `class Child extends Register.extend(parent)` and synthesizes a helper
   * declaration like `declare const Child_base: ...` in the public `.d.ts`. If
   * this helper returns `any`, that public declaration becomes `Child_base: any`
   * and downstream users lose type safety before they even touch their own code.
   *
   * `new (...args: unknown[]) => {}` is intentionally broad: it says "this is
   * some constructor" without claiming we know its exact parameters or instance
   * fields. That is enough for `extends`, avoids a leaked `any`, and keeps the
   * one unavoidable assertion contained in this runtime helper.
   */
  @:keep @:ts.returnType("new (...args: unknown[]) => {}")
  public static function extend(superClass) {
    // The emitter owns the surrounding method indentation. Keeping the first
    // and last target tokens beside the string delimiters avoids raw-syntax
    // newlines that would otherwise become whitespace-only output lines.
    Syntax.code('function res() {
        // Prefer the legacy Genes initializer path when present.
        // @ts-ignore
        const init = this[Register.new]
        if (typeof init === "function") {
          // @ts-ignore
          init.apply(this, arguments)
          return
        }
        // genes-ts may emit real constructors (no `[Register.new]`), so fall
        // back to delegating to the provided superclass constructor.
        return Reflect.construct(superClass, arguments, new.target)
      }
      Object.setPrototypeOf(res.prototype, superClass.prototype)
      return Register.unsafeCast(res)');
  }

  /**
   * Return a base class for `extends` that supports deferred resolution.
   *
   * This is a core part of Genes' cycle handling. The return type is a broad
   * constructor shape because the actual superclass can be resolved lazily and
   * may have an arbitrary constructor signature.
   *
   * The important part is the generated `.d.ts` surface: TypeScript creates
   * intermediate declarations for dynamic `extends` expressions. If this
   * function is typed as `any`, those intermediates leak into published
   * declarations as `declare const *_base: any`. Returning the broad constructor
   * type instead tells TypeScript "this value is constructable" while still
   * forcing every real use site to prove anything more specific.
   */
  @:keep @:ts.returnType("new (...args: unknown[]) => {}")
  public static function inherits(?resolve, defer = false) {
    // See extend(): raw syntax owns its inner layout, while the emitter owns
    // the method boundary and must not be handed an empty first/last line.
    Syntax.code('function res() {
        // @ts-ignore
        if (defer && resolve && res[Register.init]) res[Register.init]()
        // Prefer the legacy Genes initializer path when present.
        // @ts-ignore
        const init = this[Register.new]
        if (typeof init === "function") {
          // @ts-ignore
          init.apply(this, arguments)
          return
        }
        // genes-ts may emit real constructors (no `[Register.new]`). In that
        // case, delegate to the resolved superclass constructor.
        if (resolve) {
          const superClass = (defer && !resolve.prototype) ? resolve() : resolve
          // @ts-ignore
          if (superClass[Register.init]) superClass[Register.init]()
          return Reflect.construct(superClass, arguments, new.target)
        }
      }
      if (!defer) {
        if (resolve && resolve[Register.init]) {
          defer = true
          // @ts-ignore
	          res[Register.init] = () => {
	            if (resolve[Register.init]) resolve[Register.init]()
	            Object.setPrototypeOf(res.prototype, resolve.prototype)
	            // @ts-ignore
	            res[Register.init] = undefined
	          }
	        } else if (resolve) {
	          Object.setPrototypeOf(res.prototype, resolve.prototype)
	        }
      } else {
        // @ts-ignore
        res[Register.init] = () => {
          const superClass = resolve()
          if (superClass[Register.init]) superClass[Register.init]()
	          Object.setPrototypeOf(res.prototype, superClass.prototype)
	          // @ts-ignore
	          res[Register.init] = undefined
	        }
	      }
	      return Register.unsafeCast(res)');
  }

  static var fid = 0;

  /**
   * Returns the stable Haxe-JavaScript closure for one receiver/method pair.
   *
   * Why: reading an instance method as a value must preserve `this`, and
   * repeated reads must return the same closure for Haxe identity semantics.
   *
   * What: `null` methods remain `null`; the same receiver and callable reuse
   * one closure; a different receiver or callable receives a different one.
   *
   * How: the Haxe JS protocol attaches a numeric `__id__` to the callable and
   * an `hx__closures__` cache to the receiver. Those hidden mutable properties
   * are not part of the user's nominal Haxe types, so this helper deliberately
   * remains a contained dynamic runtime boundary. The emitters recover the
   * precise callable type at user-module assignments and calls. Direct uses
   * require a mutable, extensible object receiver; primitives and frozen host
   * objects are outside this internal helper's supported contract.
   */
  @:keep public static function bind(o: Dynamic, m: Dynamic) {
    if (m == null)
      return null;
    if (m.__id__ == null)
      m.__id__ = fid++;
    var f = null;
    if (o.hx__closures__ == null)
      o.hx__closures__ = {}
    else
      f = o.hx__closures__[m.__id__];
    if (f == null) {
      f = m.bind(o);
      o.hx__closures__[m.__id__] = f;
    }
    return f;
  }
}

/**
 * Typed compatibility bridge for JavaScript's `Object.create(null)`.
 *
 * Why: Haxe 4.3.7 declares the prototype parameter as non-null `{}`, although
 * JavaScript explicitly accepts `null` and newer Haxe versions model that
 * fact as `Null<{}>`. Using the old extern would otherwise require a cast or a
 * raw syntax escape in runtime code.
 *
 * What: this private extern exposes only the missing null-capable dictionary
 * creation operation. Its result is always `DynamicAccess<T>`; callers cannot
 * use it as a general-purpose assertion to an unrelated result type.
 *
 * How: `@:native("Object")` binds the declaration to JavaScript's built-in
 * constructor and emits no runtime wrapper. Keep the bridge private and narrow
 * until the minimum supported Haxe version provides the corrected signature.
 */
@:native("Object")
private extern class NullPrototypeObject {
  @:pure @:native("create") static function createDictionary<T>(prototype:Null<{}>):DynamicAccess<T>;
}

/**
 * genes-ts runtime registry type.
 *
 * The values are intentionally `unknown`: these registries store heterogeneous
 * values (classes, enums, internal helpers) and are populated dynamically at
 * runtime. Using `unknown` avoids leaking `any` into user modules.
 */
@:ts.type("{[key: string]: unknown}")
typedef HxRegistry = DynamicAccess<Dynamic>;

/**
 * `$hxClasses` registry: `Type.resolveClass(...)` and friends.
 */
@:ts.type("{[key: string]: Function}")
typedef HxClasses = DynamicAccess<Dynamic>;

/**
 * Minimal runtime shape for Haxe enum values stored in `$hxEnums`.
 *
 * We only type what the runtime reflection code actually uses today.
 */
@:ts.type("{ __constructs__: Array<{ _hx_name: string }> }")
typedef HxEnumInfo = Dynamic;

/**
 * `$hxEnums` registry: `Type.resolveEnum(...)` and friends.
 */
@:ts.type("{[key: string]: HxEnumInfo}")
typedef HxEnums = DynamicAccess<Dynamic>;

private class ArrayIterator<T> {
  final array: Array<T>;
  var current: Int = 0;

  public function new(array: Array<T>) {
    this.array = array;
  }

  public function hasNext() {
    return current < array.length;
  }

  public function next() {
    return array[current++];
  }
}
