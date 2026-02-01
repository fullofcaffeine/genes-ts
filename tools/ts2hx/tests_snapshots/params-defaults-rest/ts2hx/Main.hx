package ts2hx;

function defaults(?a: Float, ?b: String): Float {
  if (a == null) a = 1;
  if (b == null) b = "x";
  return (a + b.length);
}

function restNums(?start: Float, nums: haxe.extern.Rest<Float>): Float {
  if (start == null) start = 0;
  return (start + nums.length);
}

final restArrow: haxe.extern.Rest<String>->Float = function(items: haxe.extern.Rest<String>) {
  return items.length;
};

class C {
  public function new() {}
  public function method(?a: String, ?b: String, rest: haxe.extern.Rest<String>): Float {
    if (a == null) a = "hi";
    final bb = ((b == null) ? 0 : b.length);
    return ((a.length + bb) + rest.length);
  }
  public static function stat(?x: Float, rest: haxe.extern.Rest<Float>): Float {
    if (x == null) x = 3;
    return (x + rest.length);
  }
}

function main(): Void {
  defaults();
  restNums();
  restArrow();
  new C().method();
  C.stat();
}
