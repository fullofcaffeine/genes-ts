package ts2hx;

import ts2hx.Types.call;

/**
 * Compiler-internal ordered ESM request carrier.
 * @:keep retains typed anchors through full Haxe DCE; the Genes planner
 * consumes every marker and erases this field from JS, TS, and declarations.
 */
@:keep
@:noCompletion
@:genes.compilerInternal
final __ts2hx_requests = {
  genes.internal.EsmRequestFact.internal(call);
  true;
};

function main(): Void {
  final fn: Types.Fn = function(a, b) return ("" + a + (b ?? ""));
  trace(call(fn, 1, "x"));
}
