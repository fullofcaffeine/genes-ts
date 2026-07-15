/**
 * Negative metadata fixture: imported-instance typing without an import owner.
 *
 * The field forces the annotated extern into a generated TypeScript type
 * position. `@:ts.instanceType` must reject this global extern rather than
 * inventing an import or emitting a misleading `InstanceType<typeof ...>`.
 */
@:ts.instanceType
extern class MissingRequireConstructor {
  public function new();
}

class MissingRequireMain {
  public static var value: MissingRequireConstructor;

  public static function main(): Void {}
}
