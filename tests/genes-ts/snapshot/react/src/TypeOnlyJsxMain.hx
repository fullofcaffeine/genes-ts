import genes.react.Element;

/**
 * Proves a React element type can appear in TypeScript without authored markup.
 *
 * The exported function is intentionally ordinary Haxe. Genes must retain its
 * `Element` annotations as `JSX.Element` in `.ts` or `.tsx` and plan the
 * matching type-only React namespace import even though `JsxPlan` has no
 * markup intent in this module.
 */
class TypeOnlyJsxMain {
  // Export this method from the generated module as `renderWithoutMarkup`;
  // without `@:expose`, it remains only a static member of this Haxe class.
  @:expose("renderWithoutMarkup")
  public static function render(renderer: Element->String,
      element: Element): String {
    return renderer(element);
  }

  static function main(): Void {}
}
