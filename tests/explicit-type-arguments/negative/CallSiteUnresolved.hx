import genes.ts.TypeArguments;

private extern class UnresolvedCellModule {
  @:ts.explicitTypeArguments
  @:jsRequire("generic-cell", "makeCell")
  static function makeCell<Value>(initial: Value): Value;
}

class CallSiteUnresolved {
  static function main(): Void {
    TypeArguments.call(UnresolvedCellModule.makeCell("pending"), null);
  }
}
