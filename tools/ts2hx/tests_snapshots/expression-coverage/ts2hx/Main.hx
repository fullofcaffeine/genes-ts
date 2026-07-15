package ts2hx;

function main(): Void {
  var x = 1;
  (function() {
  var __ts2hx_old0 = x;
  var __ts2hx_rhs1 = 2;
  return x = (__ts2hx_old0 + __ts2hx_rhs1);
})();
  (function() {
  var __ts2hx_old2 = x;
  var __ts2hx_rhs3 = 1;
  return x = (__ts2hx_old2 - __ts2hx_rhs3);
})();
  final a = x++;
  final b = ++x;
  final s0 = "a";
  final s1 = (s0 + "b");
  final label = ((x > 2) ? "big" : "small");
  final t = js.Syntax.typeof(label);
  final n = -(x);
  final p = x;
  final not = !(false);
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
