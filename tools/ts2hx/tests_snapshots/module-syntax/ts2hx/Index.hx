package ts2hx;

import ts2hx.Main.main;

/**
 * Compiler-internal ordered ESM request carrier.
 * @:keep retains typed anchors through full Haxe DCE; the Genes planner
 * consumes every marker and erases this field from JS, TS, and declarations.
 */
@:keep
@:noCompletion
@:genes.compilerInternal
final __ts2hx_requests = {
  genes.internal.EsmRequestFact.internal(main);
  true;
};

// TS2HX-UNSUPPORTED-LOWERING-001: assisted output omitted ExpressionStatement at index.ts:3:1.
