package ts2hx;

function defaults(?a: genes.ts.Undefinable<Float>, ?b: genes.ts.Undefinable<String>): Float {
  if (genes.ts.Undefinable.isAbsent(a)) a = 1;
  var __ts2hx_a_value0: Float = a.assumePresent();
  if (genes.ts.Undefinable.isAbsent(b)) b = "x";
  var __ts2hx_b_value1: String = b.assumePresent();
  return (__ts2hx_a_value0 + __ts2hx_b_value1.length);
}

function restNums(?start: genes.ts.Undefinable<Float>, nums: haxe.extern.Rest<Float>): Float {
  if (genes.ts.Undefinable.isAbsent(start)) start = 0;
  var __ts2hx_start_value2: Float = start.assumePresent();
  return (__ts2hx_start_value2 + nums.length);
}

final restArrow: haxe.extern.Rest<String>->Float = function(items: haxe.extern.Rest<String>) {
  return items.length;
};

class C {
  public function new() {}
  public function method(?a: genes.ts.Undefinable<String>, ?b: String, rest: haxe.extern.Rest<String>): Float {
    if (genes.ts.Undefinable.isAbsent(a)) a = "hi";
    var __ts2hx_a_value3: String = a.assumePresent();
    final bb = (genes.ts.Undefinable.isAbsent(b) ? 0 : b.length);
    return ((__ts2hx_a_value3.length + bb) + rest.length);
  }
  public static function stat(?x: genes.ts.Undefinable<Float>, rest: haxe.extern.Rest<Float>): Float {
    if (genes.ts.Undefinable.isAbsent(x)) x = 3;
    var __ts2hx_x_value4: Float = x.assumePresent();
    return (__ts2hx_x_value4 + rest.length);
  }
}

function main(): Void {
  defaults();
  restNums();
  restArrow();
  new C().method();
  C.stat();
}
