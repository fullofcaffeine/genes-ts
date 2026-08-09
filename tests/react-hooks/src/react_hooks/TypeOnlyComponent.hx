package react_hooks;

import genes.react.Element;

typedef TypeOnlyComponentProps = {
  final child: Element;
}

/**
 * Analyzer-visible module component with no HXX expression of its own.
 *
 * This isolates type-only dependency planning: the moved function and its
 * compiler-owned descriptor both name `JSX.Element`, so the generated module
 * must still import React's `JSX` namespace type.
 */
@:genes.reactComponent
function Identity(props: TypeOnlyComponentProps): Element {
  return props.child;
}

/**
 * Proves that an ordinary component may intentionally render nothing.
 *
 * The nullable wrapper remains narrower than the broad React-node contract:
 * the function returns one exact element or `null`, never text or an array.
 */
@:genes.reactComponent
function OptionalIdentity(props: TypeOnlyComponentProps): Null<Element> {
  return props.child;
}
