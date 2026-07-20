import genes.ts.TypeArguments;

private extern class UnmarkedCellModule {
  @:jsRequire("generic-cell", "makeCell")
  static function makeCell<Value>(initial: Value): Value;
}

class CallSiteUnmarked {
  static function main(): Void {
    TypeArguments.call(UnmarkedCellModule.makeCell("pending"), "pending");
  }
}
