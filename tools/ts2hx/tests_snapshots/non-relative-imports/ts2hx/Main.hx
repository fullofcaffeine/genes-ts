package ts2hx;

/**
 * Compiler-internal ordered ESM request carrier.
 * @:keep retains typed anchors through full Haxe DCE; the Genes planner
 * consumes every marker and erases this field from JS, TS, and declarations.
 */
@:keep
@:noCompletion
@:genes.compilerInternal
final __ts2hx_requests = {
  genes.internal.EsmRequestFact.external("fakepkg", null);
  genes.internal.EsmRequestFact.external("fakepkg", null);
  true;
};

function main(): Void {
  trace(ts2hx.extern.Fakepkg.__default("world"));
  trace(ts2hx.extern.Fakepkg.add(1, 2));
  trace(ts2hx.extern.Fakepkg.add(3, 4));
  trace(ts2hx.extern.Fakepkg.PI);
}
