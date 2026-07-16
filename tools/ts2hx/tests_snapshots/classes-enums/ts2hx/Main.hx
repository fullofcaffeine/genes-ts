package ts2hx;

import ts2hx.Models.Counter;
import ts2hx.Models.Color;

/**
 * Compiler-internal ordered ESM request carrier.
 * @:keep retains typed anchors through full Haxe DCE; the Genes planner
 * consumes every marker and erases this field from JS, TS, and declarations.
 */
@:keep
@:noCompletion
@:genes.compilerInternal
final __ts2hx_requests = {
  genes.internal.EsmRequestFact.internal(Counter);
  true;
};

function main(): Void {
  Counter.example(Color.Red);
}
