import genes.react.Element;
import genes.react.InputElement;
import genes.react.MouseEvent;
import genes.react.SyntheticEvent;
import genes.ts.Undefinable;
import genes.ts.Unknown;

typedef RequiredProps = {
  final label: String;
}

typedef TextChildProps = {
  final children: String;
}

typedef TextChildListProps = {
  final children: Array<String>;
}

/**
 * Models a spread whose `children` field may be absent at runtime.
 *
 * `@:optional` tells Haxe the object can omit the field, which is the exact
 * fact this diagnostic exercises. `@:ts.optional` is deliberately absent:
 * that separate metadata changes null/undefined output for a supplied value,
 * not the property's runtime presence.
 */
typedef OptionalTextChildSpreadProps = {
  @:optional
  var children: String;
}

typedef MaybeRequiredProps = {
  @:optional var label: String;
}

typedef NotReactNode = {
  final label: String;
}

typedef AbstractSpreadFields = {
  final label: String;
}

@:forward
abstract AbstractSpreadProps(AbstractSpreadFields) from AbstractSpreadFields {}

typedef WrongAbstractSpreadFields = {
  final label: Int;
}

@:forward
abstract WrongAbstractSpreadProps(WrongAbstractSpreadFields)
  from WrongAbstractSpreadFields {}

typedef OptionalCallbackProps = {
  final onValue: (?value: String) -> Void;
}

typedef RequiredCallbackProps = {
  final onValue: String->Void;
}

extern class FirstEventTarget {}
extern class SecondEventTarget {}

/** Same visible method as FormData, but no explicit shared host identity. */
extern class StructuralFormData {
  function has(name: String): Bool;
}

/** Explicitly points at a different native global and must stay incompatible. */
@:native("URLSearchParams")
extern class WrongHostFormData {
  function has(name: String): Bool;
}

typedef EventProps = {
  final onClick: MouseEvent<FirstEventTarget>->Void;
}

typedef StringListProps = {
  final values: Array<String>;
}

typedef WeakSchemaProps = {
  // Deliberately invalid: component contracts must never hide weak values.
  final value: Dynamic;
}

typedef NullableProps = {
  final label: Null<String>;
}

typedef OptionalNullableProps = {
  @:optional var label: Null<String>;
}

typedef RequiredUndefinableProps = {
  final value: Undefinable<String>;
}

typedef RecursiveItem = {
  final label: String;
  final children: Null<Array<RecursiveItem>>;
}

typedef RecursiveItemsProps = {
  final items: Array<RecursiveItem>;
}

typedef RecursiveUnsafeItem = {
  final children: Null<Array<RecursiveUnsafeItem>>;
  // Deliberately weak: the negative fixture proves recursion cannot hide it.
  final payload: Dynamic;
}

typedef RecursiveUnsafeItemsProps = {
  final items: Array<RecursiveUnsafeItem>;
}

extern interface InheritedRequiredProps {
  var label: String;
}

extern interface InheritedExtraProps extends InheritedRequiredProps {
  var tone: String;
}

/**
 * One-source negative fixture selected by an `hxx_negative_*` build define.
 *
 * Each branch contains exactly one invalid HXX expression. The harness checks
 * its stable diagnostic and exact authored line before any TypeScript runs.
 */
class Negative {
  static function Button(props: RequiredProps): Element {
    return <button>{props.label}</button>;
  }

  static function TextChild(props: TextChildProps): Element {
    return <span>{props.children}</span>;
  }

  static function TextChildList(props: TextChildListProps): Element {
    return <span>{props.children}</span>;
  }

  static function BadReturn(): NotReactNode {
    return {label: "not an element"};
  }

  static function AsyncComponent(): js.lib.Promise<Element> {
    return js.lib.Promise.resolve(<span>Async component</span>);
  }

  static function BadAsyncReturn(): js.lib.Promise<NotReactNode> {
    return js.lib.Promise.resolve({label: "not an element"});
  }

  static function OptionalCallback(props: OptionalCallbackProps): Element {
    return <span>optional callback</span>;
  }

  static function RequiredCallback(props: RequiredCallbackProps): Element {
    return <span>required callback</span>;
  }

  static function EventButton(props: EventProps): Element {
    return <button>event</button>;
  }

  static function StringList(props: StringListProps): Element {
    return <span>{props.values.join(",")}</span>;
  }

  static function WeakSchema(props: WeakSchemaProps): Element {
    return <span>weak schema</span>;
  }

  static function NullableLabel(props: NullableProps): Element {
    return <span>{props.label}</span>;
  }

  static function OptionalNullableLabel(props: OptionalNullableProps): Element {
    return <span>{props.label}</span>;
  }

  static function RequiredUndefinable(props: RequiredUndefinableProps): Element {
    return <span>{props.value}</span>;
  }

  static function RecursiveItems(props: RecursiveItemsProps): Element {
    return <span>{props.items.length}</span>;
  }

  static function RecursiveUnsafeItems(props: RecursiveUnsafeItemsProps): Element {
    return <span>{props.items.length}</span>;
  }

  static function InheritedCard(props: InheritedExtraProps): Element {
    return <aside>{props.label}</aside>;
  }

  static function requiresValue(value: String): Void {}

  static function acceptsOptionalTail(value: String, ?debug: Bool): Void {}

  static function wrongEventTarget(event: MouseEvent<SecondEventTarget>): Void {}

  static function wrongGeneralEventTarget(event: SyntheticEvent<SecondEventTarget>): Void {}

  static function wrongAnchorEventTarget(event: MouseEvent<InputElement>): Void {}

  static function wrongFormActionParameter(value: Int): Void {}

  static function tooManyFormActionArguments(data: js.html.FormData,
    required: String): Void {}

  static function wrongAsyncFormActionResult(data: js.html.FormData): js.lib.Promise<String> {
    return js.lib.Promise.resolve("not void");
  }

  static function structuralFormAction(data: StructuralFormData): Void {}

  static function wrongHostFormAction(data: WrongHostFormData): Void {}

  static function maybeRequiredProps(): MaybeRequiredProps {
    return {};
  }

  /**
   * Models an async boundary whose result React deliberately ignores.
   *
   * `Unknown` stays inside the returned promise and never becomes the event
   * property's value. The positive branch below proves HXX checks the callback
   * arguments while respecting the expected `Void` result contract.
   */
  static function ignoredAsyncResult(): js.lib.Promise<Unknown> {
    return js.lib.Promise.resolve(Unknown.fromBoundary("ignored result"));
  }

  static function main(): Void {
    #if hxx_negative_unknown_intrinsic
    final value = <dvi />;
    #elseif hxx_negative_unknown_custom_intrinsic
    final value = <x-widget />;
    #elseif hxx_negative_intrinsic_prop
    final value = <div href="/wrong" />;
    #elseif hxx_negative_intrinsic_prop_type
    final value = <button disabled="yes" />;
    #elseif hxx_negative_svg_dash_type
    final value = <circle strokeDashoffset={false} />;
    #elseif hxx_negative_intrinsic_null
    // React's `href?: string | undefined` accepts omission or an explicit
    // JavaScript undefined value. Haxe null is a different supplied value and
    // strict TypeScript rejects it, so HXX must reject it first too.
    final value = <a href={null}>Invalid null href</a>;
    #elseif hxx_negative_handler
    final value = <button onClick="not-a-handler" />;
    #elseif hxx_negative_form_action_parameter
    final value = <form action={wrongFormActionParameter}></form>;
    #elseif hxx_negative_form_action_arity
    final value = <form action={tooManyFormActionArguments}></form>;
    #elseif hxx_negative_form_action_result
    final value = <form action={wrongAsyncFormActionResult}></form>;
    #elseif hxx_negative_form_action_structural_facade
    // Matching methods do not prove that two externs name one host object.
    final value = <button formAction={structuralFormAction}>Save</button>;
    #elseif hxx_negative_form_action_wrong_host
    // A different explicit native identity must not match FormData.
    final value = <input type="submit" formAction={wrongHostFormAction} />;
    #elseif hxx_negative_component_missing
    final value = <Button />;
    #elseif hxx_negative_component_extra
    final value = <Button label="Save" extra="wrong" />;
    #elseif hxx_negative_component_wrong
    final value = <Button label={123} />;
    #elseif hxx_negative_component_duplicate
    final value = <Button label="Save" label="Again" />;
    #elseif hxx_negative_unexpected_child
    final value = <Button label="Save">wrong</Button>;
    #elseif hxx_negative_wrong_child
    final value = <TextChild><span>wrong</span></TextChild>;
    #elseif hxx_negative_missing_child
    final value = <TextChild />;
    #elseif hxx_negative_scalar_for_array_child
    final value = <TextChildList>one</TextChildList>;
    #elseif hxx_negative_unsafe_array_child
    // This intentionally weak boundary proves that using one array expression
    // for `children` still performs HXX's normal deep type-safety check.
    final unsafeChildren: Array<Dynamic> = ["unsafe"];
    final value = <TextChildList>{unsafeChildren}</TextChildList>;
    #elseif hxx_negative_named_and_nested_child
    final value = <TextChild children="one">two</TextChild>;
    #elseif hxx_negative_required_spread_and_nested_child
    final props: TextChildProps = {children: "one"};
    final value = <TextChild {...props}>two</TextChild>;
    #elseif hxx_negative_optional_spread_missing_child
    final props: OptionalTextChildSpreadProps = {};
    final value = <TextChild {...props} />;
    #elseif hxx_negative_intrinsic_child
    final invalid = {label: "not a React child"};
    final value = <div>{invalid}</div>;
    #elseif hxx_negative_spread_non_object
    final invalid = 42;
    final value = <div {...invalid} />;
    #elseif hxx_negative_spread_extra
    final invalid = {href: "/wrong"};
    final value = <div {...invalid} />;
    #elseif hxx_negative_spread_wrong
    final invalid = {label: 42};
    final value = <Button {...invalid} />;
    #elseif hxx_negative_abstract_spread_wrong
    final props: WrongAbstractSpreadProps = {label: 42};
    final value = <Button {...props} />;
    #elseif hxx_negative_spread_optional_required
    final value = <Button {...maybeRequiredProps()} />;
    #elseif hxx_negative_non_component
    final NotComponent = 42;
    final value = <NotComponent />;
    #elseif hxx_negative_component_return
    final value = <BadReturn />;
    #elseif hxx_negative_async_component_return
    final value = <BadAsyncReturn />;
    #elseif hxx_negative_unsafe_key
    // This deliberately weak value exists only to prove HXX rejects an unsafe
    // boundary before anything is emitted. Successful fixtures never use it.
    final unsafeKey: Dynamic = "unsafe";
    final value = <Button label="Save" key={unsafeKey} />;
    #elseif hxx_negative_event_target
    final value = <EventButton onClick={wrongEventTarget} />;
    #elseif hxx_negative_inherited_event_target
    final value = <EventButton onClick={wrongGeneralEventTarget} />;
    #elseif hxx_negative_anchor_event_target
    // Browser compatibility is exact: an input target cannot fill an anchor
    // handler merely because both types are DOM elements.
    final value = <a onClick={wrongAnchorEventTarget}>Wrong target</a>;
    #elseif hxx_negative_optional_callback
    final value = <OptionalCallback onValue={requiresValue} />;
    #elseif hxx_negative_inherited_missing
    final value = <InheritedCard tone="warm" />;
    #elseif hxx_negative_nested_unsafe
    // This deliberately weak element type proves that a typed container does
    // not hide an unsafe value from HXX validation.
    final unsafeValues: Array<Dynamic> = ["unsafe"];
    final value = <StringList values={unsafeValues} />;
    #elseif hxx_negative_schema_unsafe
    // A concrete value cannot make a weak component declaration safe. The
    // contract itself must be precise before HXX relies on it.
    final value = <WeakSchema value="apparently safe" />;
    #elseif hxx_negative_any_value
    // Core Any is an unchecked boundary even though Haxe can unify it with a
    // concrete property type in both directions.
    final unsafeValue: Any = "unsafe";
    final value = <Button label={unsafeValue} />;
    #elseif hxx_negative_nested_any
    // A container does not make its Any element contract precise.
    final unsafeValues: Array<Any> = ["unsafe"];
    final value = <StringList values={unsafeValues} />;
    #elseif hxx_negative_nullable_prop
    // Passing a property explicitly is different from omitting it. A value
    // that may be null cannot fill a required non-null String contract.
    final nullableLabel: Null<String> = null;
    final value = <Button label={nullableLabel} />;
    #elseif hxx_negative_nullable_payload
    // A nullable contract still checks the type carried inside Null<T>.
    final nullableNumber: Null<Int> = 1;
    final value = <NullableLabel label={nullableNumber} />;
    #elseif hxx_negative_required_undefinable_missing
    // A required property stays required even when its supplied value may be
    // JavaScript undefined.
    final value = <RequiredUndefinable />;
    #elseif hxx_negative_null_to_undefinable
    // Haxe null and JavaScript undefined are separate boundary contracts.
    final nullableLabel: Null<String> = null;
    final value = <RequiredUndefinable value={nullableLabel} />;
    #elseif hxx_negative_recursive_unsafe
    // The recursive edge is valid, but it must not hide this deliberately
    // weak payload from HXX's deep property validation.
    final item: RecursiveUnsafeItem = {
      children: null,
      payload: "unsafe"
    };
    final value = <RecursiveUnsafeItems items={[item]} />;
    #elseif hxx_negative_duplicate_prefix
    final value = <x-duplicate />;
    #elseif hxx_negative_ts_optional_null
    final value = <x-ts-optional label={null}>Invalid null</x-ts-optional>;
    #elseif hxx_positive_ignored_callback_result
    // @formatter:off
    final value = <button onClick={() -> ignoredAsyncResult()} />;
    // @formatter:on
    #elseif hxx_positive_async_component_return
    // React 19 admits a Promise of a renderable node from a component. HXX
    // checks the inner node type before any TypeScript output is generated.
    final value = <AsyncComponent />;
    #elseif hxx_positive_abstract_spread
    // The abstract remains a zero-runtime typed view over one closed object.
    final props: AbstractSpreadProps = {label: "abstract spread"};
    final value = <Button {...props} />;
    #elseif hxx_positive_recursive_props
    final item: RecursiveItem = {
      label: "root",
      children: null
    };
    final value = <RecursiveItems items={[item]} />;
    #elseif hxx_positive_nullable_prop
    // Nullable values remain valid when the component contract explicitly
    // admits null; only nullable-to-required assignments are rejected.
    final nullableLabel: Null<String> = null;
    final value = <NullableLabel label={nullableLabel} />;
    #elseif hxx_positive_plain_to_nullable
    final value = <NullableLabel label="present" />;
    #elseif hxx_positive_literal_null
    final value = <NullableLabel label={null} />;
    #elseif hxx_positive_undefinable_prop
    // The key is present even though its value intentionally carries the
    // JavaScript undefined sentinel.
    final maybeValue: Undefinable<String> = Undefinable.absent();
    final value = <RequiredUndefinable value={maybeValue} />;
    #elseif hxx_positive_optional_nullable_spread
    final props: OptionalNullableProps = {label: null};
    final value = <OptionalNullableLabel {...props} />;
    #elseif hxx_positive_optional_trailing_callback
    // A callback may accept an extra optional parameter: React calls it with
    // the required prefix and the callback does not require the extra value.
    final value = <RequiredCallback onValue={acceptsOptionalTail} />;
    #elseif hxx_positive_ts_optional_undefined
    final absentLabel: Undefinable<String> = Undefinable.absent();
    final value = <x-ts-optional label={absentLabel}>Absent label</x-ts-optional>;
    #elseif hxx_positive_ts_optional_spread
    final props: TsOptionalElements.TsOptionalProps = {};
    final value = <x-ts-optional {...props} />;
    #elseif hxx_negative_dynamic_marker_unsafe_prop
    // A runtime tag cannot select one intrinsic schema, but its marker values
    // must still cross HXX's normal deep type-safety gate before emission.
    // Dynamic is intentional only in this negative fixture: a properly typed
    // value would be safe and could not prove that compilation stops before
    // the weak value reaches generated code.
    final runtimeTag = "aside";
    final unsafeValue: Dynamic = "unsafe";
    final value = genes.react.internal.Jsx.__jsx(runtimeTag, {
      __genesJsxPropName: "data-mode",
      __genesJsxPropValue: unsafeValue,
      __genesJsxPropNext: {
        __genesJsxPropsEnd: true
      }
    }, {__genesJsxChildrenEnd: true});
    #end
  }
}
