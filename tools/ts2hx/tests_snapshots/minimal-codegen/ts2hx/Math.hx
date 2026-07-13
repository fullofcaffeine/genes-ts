package ts2hx;

typedef Num = Float;

typedef Point = {
  var x: Float;
  @:optional @:ts.optional var y: Float;
}

function add(a: Float, b: Float): Float {
  return (a + b);
}
