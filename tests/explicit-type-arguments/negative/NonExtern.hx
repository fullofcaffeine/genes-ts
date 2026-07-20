private class LocalFactory {
  @:ts.explicitTypeArguments
  public static function make<Value>(value: Value): Value {
    return value;
  }
}

class NonExtern {
  static function main(): Void {
    LocalFactory.make(1);
  }
}
