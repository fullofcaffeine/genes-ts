package ts2hx;

import ts2hx.components.Button;

/**
 * Compiler-internal ordered ESM request carrier.
 * @:keep retains typed anchors through full Haxe DCE; the Genes planner
 * consumes every marker and erases this field from JS, TS, and declarations.
 */
@:keep
@:noCompletion
@:genes.compilerInternal
final __ts2hx_requests = {
  genes.internal.EsmRequestFact.internal(Button);
  true;
};

function main(): Void {
  final el = Button({ label: "ok" });
  trace(((el != null) ? "BASIC_TSX_OK" : "BASIC_TSX_FAIL"));
}
