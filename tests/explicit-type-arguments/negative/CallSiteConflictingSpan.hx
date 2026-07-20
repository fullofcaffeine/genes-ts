private enum abstract Phase(String) to String {
  final Pending = "pending";
  final Ready = "ready";
}

private extern class Cell<Value> {}

private extern class CellModule {
  @:ts.explicitTypeArguments
  static function make<Value>(value: Value): Cell<Value>;
}

/** Proves a macro cannot attach two different types to one generated call. */
class CallSiteConflictingSpan {
  static function main(): Void {
    ConflictingCallMacro.expand(CellModule.make(Phase.Pending),
      Phase.Pending, "wider");
  }
}
