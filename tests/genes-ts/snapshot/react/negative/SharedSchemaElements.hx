typedef SharedProps = {
  final tone: String;
}

typedef SharedOther = {
  final count: Int;
}

typedef SharedBox<T> = {
  final value: T;
}

/**
 * Custom intrinsic provider whose tags repeat and nearly repeat one typedef.
 *
 * Why: the HXX checker builds one property schema for each distinct typedef a
 * provider declares, then gives that schema to every tag that names the same
 * typedef. The tags below prove which declarations are the same contract.
 *
 * How: `x-first` and `x-second` name one typedef and must enforce the same
 * properties. `x-other` names a typedef with the same name from another
 * module. `x-sibling` names a different typedef from this module. `x-text`
 * and `x-count` name one generic typedef with different type arguments. Each
 * of those four must keep its own schema.
 */
extern class SharedSchemaElements {
  @:genes.jsxIntrinsic("x-first")
  public static var first: SharedProps;

  @:genes.jsxIntrinsic("x-second")
  public static var second: SharedProps;

  @:genes.jsxIntrinsic("x-other")
  public static var other: sharedschema.SharedProps;

  @:genes.jsxIntrinsic("x-sibling")
  public static var sibling: SharedOther;

  @:genes.jsxIntrinsic("x-text")
  public static var text: SharedBox<String>;

  @:genes.jsxIntrinsic("x-count")
  public static var count: SharedBox<Int>;
}
