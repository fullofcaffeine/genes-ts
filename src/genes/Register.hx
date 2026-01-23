package genes;

import haxe.DynamicAccess;
import js.lib.Object;
import js.Syntax;

class Register {
  @:keep @:native("$global")
  public static final _global = js.Syntax.code('globalThis');

  @:ts.type("{[key: string]: any}")
  static final globals: DynamicAccess<Dynamic> = {}
  @:keep @:native('new')
  @:ts.type("unique symbol")
  static final construct = new js.lib.Symbol();
  @:keep @:ts.type("unique symbol") static final init = new js.lib.Symbol();

  @:keep public static function global(name: String) {
    final existing = globals.get(name);
    if (existing != null)
      return existing;
    final created = {};
    globals.set(name, created);
    return created;
  }

  @:keep public static function createStatic<T>(obj: {}, name: String,
      get: Null<() -> T>) {
    var value: T = null;
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

  @:keep public static function iterator<T>(@:ts.type("any") a: Array<T>): Void->Iterator<T> {
    return if (!(Syntax.code("Array.isArray({0})", a) : Bool))
      js.Syntax.code('typeof a.iterator === "function" ? a.iterator.bind(a) : a.iterator') else
      mkIter.bind(a);
  }

  @:keep public static function getIterator<T>(@:ts.type("any") a: Array<T>): Iterator<T> {
    return if (!(Syntax.code("Array.isArray({0})", a) : Bool)) js.Syntax.code('a.iterator()') else
      mkIter(a);
  }

  @:keep static function mkIter<T>(a: Array<T>): Iterator<T> {
    return new ArrayIterator(a);
  }

  @:keep @:ts.returnType("any")
  public static function extend(superClass) {
    Syntax.code('
      function res() {
        // @ts-ignore
        this[Register.new].apply(this, arguments)
      }
      Object.setPrototypeOf(res.prototype, superClass.prototype)
      return res
    ');
  }

  @:keep @:ts.returnType("any")
  public static function inherits(?resolve, defer = false) {
    Syntax.code('
      function res() {
        // @ts-ignore
        if (defer && resolve && res[Register.init]) res[Register.init]()
        // @ts-ignore
        this[Register.new].apply(this, arguments)
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
	      return res
	    ');
  }

  static var fid = 0;

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
