package ts2hx;

typedef MouseEvent<T> = genes.react.MouseEvent<T>;
typedef ReactElement = genes.react.Element;

typedef LinkNode = { var label: String; var href: String; var children: Null<Array<LinkNode>>; };

function NestedLinks(_p0: { var items: Array<LinkNode>; @:optional @:ts.optional var disabled: Bool; @:optional @:ts.optional var onClick: MouseEvent<genes.react.AnchorElement>->Void; @:optional @:ts.optional var ordered: Bool; }): ReactElement {
  var __ts2hx_tmp0 = _p0;
  var __ts2hx_tmp1 = __ts2hx_tmp0.items;
  var items = __ts2hx_tmp1;
  var __ts2hx_tmp2 = __ts2hx_tmp0.disabled;
  var disabled = __ts2hx_tmp2;
  var __ts2hx_tmp3 = __ts2hx_tmp0.onClick;
  var onClick = __ts2hx_tmp3;
  var __ts2hx_tmp4 = __ts2hx_tmp0.ordered;
  var ordered = (__ts2hx_tmp4 == null ? true : __ts2hx_tmp4);
  return (genes.react.internal.Jsx.__frag({ __genesJsxChildValue: genes.js.ArrayCallbacks.mapWithIndex(items, function(item, index) {
  final ListTag = (ordered ? "ol" : "ul");
  return (genes.react.internal.Jsx.__jsx("li", { __genesJsxPropName: "key", __genesJsxPropValue: index, __genesJsxPropNext: { __genesJsxPropsEnd: true } }, { __genesJsxChildValue: genes.react.internal.Jsx.__jsx("a", { __genesJsxPropName: "href", __genesJsxPropValue: item.href, __genesJsxPropNext: { __genesJsxPropName: "aria-disabled", __genesJsxPropValue: genes.ts.Undefinable.fromNullable((genes.js.Truthiness.isTruthy(disabled) ? genes.ts.Undefinable.fromNullable(disabled) : genes.ts.Undefinable.absent())), __genesJsxPropNext: { __genesJsxPropName: "onClick", __genesJsxPropValue: genes.ts.Undefinable.fromNullable((genes.js.Truthiness.isTruthy((genes.js.Truthiness.isTruthy(disabled) ? genes.js.TypeChecks.isFunction(onClick) : disabled)) ? genes.ts.Undefinable.fromNullable(onClick) : genes.ts.Undefinable.absent())), __genesJsxPropNext: { __genesJsxPropsEnd: true } } } }, { __genesJsxChildValue: item.label, __genesJsxChildNext: { __genesJsxChildrenEnd: true } }), __genesJsxChildNext: { __genesJsxChildValue: genes.react.Children.nullable((function() {
  var __ts2hx_condition5 = item.children;
  return (__ts2hx_condition5 != null ? (genes.react.internal.Jsx.__jsx(ListTag, { __genesJsxPropsEnd: true }, { __genesJsxChildValue: genes.react.internal.Jsx.__jsx(NestedLinks, { __genesJsxPropName: "items", __genesJsxPropValue: genes.ts.Present.require(__ts2hx_condition5), __genesJsxPropNext: { __genesJsxPropName: "disabled", __genesJsxPropValue: genes.ts.Undefinable.fromNullable(disabled), __genesJsxPropNext: { __genesJsxPropName: "onClick", __genesJsxPropValue: genes.ts.Undefinable.fromNullable((genes.js.Truthiness.isTruthy((genes.js.Truthiness.isTruthy(disabled) ? genes.js.TypeChecks.isFunction(onClick) : disabled)) ? genes.ts.Undefinable.fromNullable(onClick) : genes.ts.Undefinable.absent())), __genesJsxPropNext: { __genesJsxPropName: "ordered", __genesJsxPropValue: ordered, __genesJsxPropNext: { __genesJsxPropsEnd: true } } } } }, { __genesJsxChildrenEnd: true }), __genesJsxChildNext: { __genesJsxChildrenEnd: true } })) : null);
})()), __genesJsxChildNext: { __genesJsxChildrenEnd: true } } }));
}), __genesJsxChildNext: { __genesJsxChildrenEnd: true } }));
}

function main(): Void {
  final onClick = function(event: MouseEvent<genes.react.AnchorElement>) return event.preventDefault();
  final element = NestedLinks({ items: [{ label: "Guide", href: "#guide", children: null }], disabled: true, onClick: onClick, ordered: false });
  trace(((element != null) ? "REACT_TYPES_OK" : "REACT_TYPES_FAIL"));
}
