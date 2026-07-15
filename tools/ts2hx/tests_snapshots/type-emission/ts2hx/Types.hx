package ts2hx;

typedef MaybeString = genes.ts.Undefinable<Null<String>>;

typedef MaybeNumOrStr = Null<haxe.extern.EitherType<String, Float>>;

typedef Fn = Float->Null<String>->String;

typedef Qualified = NS.Bar;

function call(fn: Fn, a: Float, ?b: String): String {
  return fn(a, b);
}
