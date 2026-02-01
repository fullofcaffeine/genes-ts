package ts2hx;

function main(): Void {
  var x = 1;
  (x = (x + 2));
  (x = (x - 1));
  final a = x++;
  final b = ++x;
  final s0 = "a";
  final s1 = (s0 + "b");
  final label = ((x > 2) ? "big" : "small");
  final t = js.Syntax.typeof(label);
  final n = -(x);
  final p = (x);
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
