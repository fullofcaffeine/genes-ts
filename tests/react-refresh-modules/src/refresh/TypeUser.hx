package refresh;

import refresh.Widget;

/**
 * Uses the class, enum and interface of the split module `Widget` only as
 * parameter types, so Genes writes a type-only import from `Widget.js`.
 */
@:keep
class TypeUser {
  public static function describe(model: Model, kind: Kind, named: Named,
      props: WidgetProps): String {
    return "typed";
  }
}
