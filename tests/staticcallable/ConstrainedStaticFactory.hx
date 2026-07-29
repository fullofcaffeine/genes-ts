package tests.staticcallable;

/**
 * Retains a call-site parameter whose constraint names another parameter.
 *
 * This is the emitted counterpart to the macro-level constraint control. It
 * proves dependency planning sees every type the projected constraint prints.
 */
@:keep
class ConstrainedStaticFactory<T> {
  public final value: T;

  public function new(value: T) {
    this.value = value;
  }

  @:keep
  public static function wrap(value) {
    return new ConstrainedStaticFactory(value);
  }
}

@:keep
class ConstrainedStaticSignatureApi {
  public static function create<Element,
    Value: StaticConstraint<Element>>(value: Value): ConstrainedStaticFactory<Value> {
    return ConstrainedStaticFactory.wrap(value);
  }
}
