package ts2hx;

function main(): Void {
  var base = { a: 1, inc: function(x: Float) return (x + 1) };
  var extra = { b: 2 };
  var merged = js.lib.Object.assign(cast {}, base, extra, { c: 3 });
  trace(merged.a);
  trace(merged.inc(1));
  trace(merged.b);
  trace(merged.c);
}
