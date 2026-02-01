package ts2hx;

typedef MaybeString = Null<String>;

typedef MaybeNumOrStr = haxe.extern.EitherType<String, Float>;

typedef Fn = Float->Null<String>->String;

typedef Qualified = NS.Bar;

function call(fn: Fn, a: Float, ?b: String): String {
  return fn(a, b);
}
