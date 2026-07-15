package ts2hx;

typedef MouseEvent<T> = genes.react.MouseEvent<T>;
typedef ReactElement = genes.react.Element;

typedef LinkNode = { var label: String; var href: String; var children: Null<Array<LinkNode>>; };

function NestedLinks(_p0: { var items: Array<LinkNode>; @:optional @:ts.optional var disabled: Bool; @:optional @:ts.optional var onClick: MouseEvent<js.html.AnchorElement>->Void; @:optional @:ts.optional var ordered: Bool; }): ReactElement {
  var __ts2hx_tmp0 = _p0;
  var __ts2hx_tmp1 = __ts2hx_tmp0.items;
  var items = __ts2hx_tmp1;
  var __ts2hx_tmp2 = __ts2hx_tmp0.disabled;
  var disabled = __ts2hx_tmp2;
  var __ts2hx_tmp3 = __ts2hx_tmp0.onClick;
  var onClick = __ts2hx_tmp3;
  var __ts2hx_tmp4 = __ts2hx_tmp0.ordered;
  var ordered = (__ts2hx_tmp4 == null ? true : __ts2hx_tmp4);
  return (genes.react.internal.Jsx.__frag([genes.js.ArrayCallbacks.mapWithIndex(items, function(item, index) {
  final ListTag = (ordered ? "ol" : "ul");
  return (genes.react.internal.Jsx.__jsx("li", [{ name: "key", value: index }], [genes.react.internal.Jsx.__jsx("a", [{ name: "href", value: item.href }, { name: "aria-disabled", value: genes.ts.Undefinable.fromNullable((genes.js.Truthiness.isTruthy(disabled) ? genes.ts.Undefinable.fromNullable(disabled) : genes.ts.Undefinable.absent())) }, { name: "onClick", value: genes.ts.Undefinable.fromNullable((genes.js.Truthiness.isTruthy((genes.js.Truthiness.isTruthy(disabled) ? genes.js.TypeChecks.isFunction(onClick) : disabled)) ? genes.ts.Undefinable.fromNullable(onClick) : genes.ts.Undefinable.absent())) }], [item.label]), genes.react.Children.nullable((function() {
  var __ts2hx_condition5 = item.children;
  return (__ts2hx_condition5 != null ? (genes.react.internal.Jsx.__jsx(ListTag, [], [genes.react.internal.Jsx.__jsx(NestedLinks, [{ name: "items", value: genes.ts.Present.require(__ts2hx_condition5) }, { name: "disabled", value: genes.ts.Undefinable.fromNullable(disabled) }, { name: "onClick", value: genes.ts.Undefinable.fromNullable((genes.js.Truthiness.isTruthy((genes.js.Truthiness.isTruthy(disabled) ? genes.js.TypeChecks.isFunction(onClick) : disabled)) ? genes.ts.Undefinable.fromNullable(onClick) : genes.ts.Undefinable.absent())) }, { name: "ordered", value: ordered }], [])])) : null);
})())]));
})]));
}

function main(): Void {
  final onClick = function(event: MouseEvent<js.html.AnchorElement>) return event.preventDefault();
  final element = NestedLinks({ items: [{ label: "Guide", href: "#guide", children: null }], disabled: true, onClick: onClick, ordered: false });
  trace(((element != null) ? "REACT_TYPES_OK" : "REACT_TYPES_FAIL"));
}
