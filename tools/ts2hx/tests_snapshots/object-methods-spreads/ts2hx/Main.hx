package ts2hx;

function main(): Void {
  final base = { a: 1, inc: function(x: Float) return (x + 1) };
  final extra = { b: 2 };
  final merged = js.lib.Object.assign(cast {}, base, extra, { c: 3 });
  trace(merged.a);
  trace(merged.inc(1));
  trace(merged.b);
  trace(merged.c);
}
