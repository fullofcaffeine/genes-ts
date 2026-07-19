private extern class NonGenericModule {
  @:ts.explicitTypeArguments
  @:jsRequire("generic-cell", "version")
  static function version(): String;
}

class NonGeneric {
  static function main(): Void {
    NonGenericModule.version();
  }
}
