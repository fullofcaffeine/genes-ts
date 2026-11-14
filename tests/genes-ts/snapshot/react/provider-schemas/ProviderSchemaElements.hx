typedef ClosedProps = {
  final label: String;
  @:optional final hint: String;
}

/**
 * A property typedef whose `values` field still holds an inference variable.
 *
 * Why: Haxe source cannot write an unresolved type in a typedef, but a macro
 * can supply one. `haxe.macro.MacroType` takes the type that
 * `ProviderSchemaOpenType.build` returns, which is `{values: Array<?>}`. The
 * element type stays open until the first HXX use binds it.
 *
 * How: Haxe 4.3.7 fails internally on a typedef that is only a `MacroType`,
 * so this typedef extends the macro-supplied structure with one optional
 * field instead.
 */
typedef OpenProps = {
  > haxe.macro.MacroType<[ProviderSchemaOpenType.build()]>,
  @:optional final note: String;
}

/** A second open typedef that no fixture module uses. */
typedef UnusedProps = {
  > haxe.macro.MacroType<[ProviderSchemaOpenType.build()]>,
  @:optional final note: String;
}

/**
 * Intrinsic provider for the provider-schema probe.
 *
 * `x-closed` names an ordinary typedef, which one output generation may
 * validate once and share between modules. `x-open` and `x-unused` name
 * typedefs that later inference can still change, so every checker must build
 * and check them again. See `ProviderSchemaProbe` for the cases.
 */
extern class ProviderSchemaElements {
  @:genes.jsxIntrinsic("x-closed")
  public static var closed: ClosedProps;

  @:genes.jsxIntrinsic("x-open")
  public static var open: OpenProps;

  @:genes.jsxIntrinsic("x-unused")
  public static var unused: UnusedProps;
}

/**
 * Names `ClosedProps` again under the provider-wide optional-value policy.
 *
 * The policy changes the type of an optional field, so this provider must
 * not receive the schema that `ProviderSchemaElements` built for the same
 * typedef.
 */
@:genes.jsxOptionalValuesAllowUndefined
extern class ProviderSchemaPolicyElements {
  @:genes.jsxIntrinsic("x-policy")
  public static var policy: ClosedProps;
}
