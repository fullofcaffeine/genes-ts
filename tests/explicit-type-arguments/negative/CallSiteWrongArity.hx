import genes.ts.TypeArguments;

private extern class PairModule {
  @:ts.explicitTypeArguments
  @:jsRequire("generic-cell", "makePair")
  static function makePair<Left, Right>(left: Left, right: Right): Left;
}

class CallSiteWrongArity {
  static function main(): Void {
    TypeArguments.call(PairModule.makePair("left", true), "left");
  }
}
