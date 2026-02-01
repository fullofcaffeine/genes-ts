package ts2hx;

import ts2hx.Types.call;

function main(): Void {
  final fn: Types.Fn = function(a, b) return ("" + a + (b ?? ""));
  trace(call(fn, 1, "x"));
}
