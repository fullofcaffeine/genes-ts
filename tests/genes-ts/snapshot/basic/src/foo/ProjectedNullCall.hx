package foo;

@:genes.compilerInternal
private extern class ProjectedNullStorage {}

/**
 * Exact host null value used to exercise a lower-level TypeScript projection.
 *
 * Why: a host callable may distinguish an exact `null` arm even when Haxe
 * models the boundary through a nominal abstract. What: `@:ts.type("null")`
 * makes the emitted parameter exactly `null`. How: the nullable storage lets
 * ordinary Haxe author the literal while the abstract itself adds no runtime
 * wrapper; the call emitter must preserve that literal without an assertion.
 */
@:ts.type("null")
abstract ProjectedNull(Null<ProjectedNullStorage>)
  from Null<ProjectedNullStorage> {}

/**
 * Sibling argument whose correct spelling needs its expected record type.
 *
 * Why: fixing the preceding `null` argument must not make the call emitter
 * forget how later arguments are declared. What: Haxe calls the required field
 * `label`, while JavaScript receives the property name `function`; the
 * optional field writes Haxe `null` as JavaScript `undefined`. How: `@:native`
 * owns the host property name and `@:ts.optional` owns the optional-property
 * null/undefined boundary. Both facts live on this expected record type.
 */
typedef ProjectedNullSibling = {
  @:native("function")
  final label: String;
  @:ts.optional
  final ?note: String;
}

/** Paired projected-null behavior and ordinary non-nullability control. */
@:keep
class ProjectedNullCall {
  static function acceptProjected(value: ProjectedNull): Void {}

  static function acceptPair(value: ProjectedNull,
    sibling: ProjectedNullSibling): Void {}

  static function acceptRequired(value: String): Void {}

  public static function demo(nullable: Null<String>): Void {
    acceptProjected(null);
    acceptPair(null, {label: "kept", note: null});
    acceptRequired(nullable);
  }
}
