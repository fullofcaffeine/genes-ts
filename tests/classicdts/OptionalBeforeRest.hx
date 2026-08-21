package tests.classicdts;

/** Exposes optional-before-rest arity to classic declaration consumers. */
@:keep
class OptionalBeforeRest {
  public function new() {}

  public function optionalBeforeRest(?arg: String, ...values: Int): Int {
    return (arg == null ? 0 : arg.length) + values.length;
  }
}
