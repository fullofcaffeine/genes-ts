import genes.ts.TypeArguments;

private extern class AliasedCellModule {
  @:ts.explicitTypeArguments
  @:jsRequire("generic-cell", "makeCell")
  static function makeCell<Value>(initial: Value): Value;
}

class CallSiteAlias {
  static function main(): Void {
    final makeCell = AliasedCellModule.makeCell;
    TypeArguments.call(makeCell("pending"), "pending");
  }
}
