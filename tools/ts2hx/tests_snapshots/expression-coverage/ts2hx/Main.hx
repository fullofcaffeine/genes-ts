package ts2hx;

function main(): Void {
  var x = 1;
  (x = (x + 2));
  (x = (x - 1));
  var a = x++;
  var b = ++x;
  var s0 = "a";
  var s1 = (s0 + "b");
  var label = ((x > 2) ? "big" : "small");
  var t = js.Syntax.typeof(label);
  var n = -(x);
  var p = (x);
  var not = !(false);
  trace(x);
  trace(a);
  trace(b);
  trace(s1);
  trace(label);
  trace(t);
  trace(n);
  trace(p);
  trace(not);
}
