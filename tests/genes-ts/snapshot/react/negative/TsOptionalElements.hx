import genes.react.Node;

typedef TsOptionalProps = {
  @:optional
  @:ts.optional
  var label: String;

  @:optional
  var children: Node;
}

/**
 * Custom intrinsic proving that per-field TypeScript optionality is honored.
 *
 * Why: Haxe stores an optional `String` field as `Null<String>` internally,
 * while `@:ts.optional` promises the narrower TypeScript shape
 * `label?: string | undefined`. HXX must follow that declared host contract,
 * not accidentally accept a supplied Haxe null.
 *
 * How: unlike React's bundled provider, this class has no provider-wide
 * undefined policy. Only `label` opts in, which keeps this fixture focused on
 * the field metadata rather than a class-level setting.
 */
extern class TsOptionalElements {
  @:genes.jsxIntrinsic("x-ts-optional")
  public static var optional: TsOptionalProps;
}
