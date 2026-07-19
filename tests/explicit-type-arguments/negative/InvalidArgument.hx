private extern class InvalidArgumentModule {
  @:ts.explicitTypeArguments("unexpected")
  @:jsRequire("generic-cell", "makeCell")
  static function makeCell<Value>(initial: Value): Value;
}

class InvalidArgument {
  static function main(): Void {
    InvalidArgumentModule.makeCell(1);
  }
}
