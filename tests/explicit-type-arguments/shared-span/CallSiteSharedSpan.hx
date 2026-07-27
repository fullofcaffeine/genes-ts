private enum abstract Phase(String) to String {
  final Pending = "pending";
  final Ready = "ready";
}

private extern class Cell<Value> {}

private extern class CellModule {
  @:ts.explicitTypeArguments
  static function make<Value>(value: Value): Cell<Value>;
}

/** Proves copied positions do not merge two occurrence-local type witnesses. */
class CallSiteSharedSpan {
  static function main(): Void {
    SharedSpanCallMacro.expand(CellModule.make(Phase.Pending),
      Phase.Pending, "wider");
  }
}
