import genes.react.Element;
import genes.react.JSX.*;

typedef RetainedImportedStatusViewProps = {
  final value: String;
}

typedef RetainedImportedStatusProps = {
  final label: String;
  final value: String;
  final children: Element;
}

typedef RetainedImportedChildProps = {}

/** Direct package component kept behind its exact Haxe property contract. */
@:jsRequire("./retained-carrier-components.js", "DirectParent")
@:genes.jsxComponentProps("RetainedImportedStatusView.RetainedImportedStatusProps")
extern class RetainedImportedStatus {}

/** Getter-capable component field that forces the child-first temporary. */
@:jsRequire("./retained-carrier-components.js", "default")
extern class RetainedObservableComponents {
  static function Child(props: RetainedImportedChildProps): Element;
}

/** Exact native calls that make property/child evaluation order observable. */
private extern class RetainedPropsOrder {
  @:jsRequire("./retained-carrier-components.js", "recordCarrierProp")
  static function recordProp(value: String): String;

  @:jsRequire("./retained-carrier-components.js", "recordCarrierChild")
  static function recordChild(value: String): String;
}

/**
 * Reproduces a retained nested imported component in a module-level function.
 *
 * Both method calls may have observable behavior, so HXX evaluates the named
 * properties before the nested child. The imported element itself must remain
 * a later temporary because its ESM binding is live; source cleanup may change
 * only the compiler carrier used to hold those already-evaluated properties.
 */
@:genes.reactComponent
function RetainedImportedStatusView(props: RetainedImportedStatusViewProps): Element {
  return <article data-component="retained-imported-status">
    <RetainedImportedStatus
      label="Nested"
      value={RetainedPropsOrder.recordProp(props.value)}
    >
      <button type="button">
        <RetainedObservableComponents.Child />
        <span>{RetainedPropsOrder.recordChild(props.value)}</span>
      </button>
    </RetainedImportedStatus>
  </article>;
}
