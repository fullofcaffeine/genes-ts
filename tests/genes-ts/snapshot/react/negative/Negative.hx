import genes.react.Element;
import genes.react.MouseEvent;
import genes.react.SyntheticEvent;

typedef RequiredProps = {
  final label: String;
}

typedef TextChildProps = {
  final children: String;
}

typedef MaybeRequiredProps = {
  @:optional var label: String;
}

typedef NotReactNode = {
  final label: String;
}

typedef OptionalCallbackProps = {
  final onValue: (?value: String) -> Void;
}

extern class FirstEventTarget {}
extern class SecondEventTarget {}

typedef EventProps = {
  final onClick: MouseEvent<FirstEventTarget>->Void;
}

typedef StringListProps = {
  final values: Array<String>;
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

  static function BadReturn(): NotReactNode {
    return {label: "not an element"};
  }

  static function OptionalCallback(props: OptionalCallbackProps): Element {
    return <span>optional callback</span>;
  }

  static function EventButton(props: EventProps): Element {
    return <button>event</button>;
  }

  static function StringList(props: StringListProps): Element {
    return <span>{props.values.join(",")}</span>;
  }

  static function InheritedCard(props: InheritedExtraProps): Element {
    return <aside>{props.label}</aside>;
  }

  static function requiresValue(value: String): Void {}

  static function wrongEventTarget(event: MouseEvent<SecondEventTarget>): Void {}

  static function wrongGeneralEventTarget(event: SyntheticEvent<SecondEventTarget>): Void {}

  static function maybeRequiredProps(): MaybeRequiredProps {
    return {};
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
    #elseif hxx_negative_handler
    final value = <button onClick="not-a-handler" />;
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
    #elseif hxx_negative_named_and_nested_child
    final value = <TextChild children="one">two</TextChild>;
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
    #elseif hxx_negative_spread_optional_required
    final value = <Button {...maybeRequiredProps()} />;
    #elseif hxx_negative_non_component
    final NotComponent = 42;
    final value = <NotComponent />;
    #elseif hxx_negative_component_return
    final value = <BadReturn />;
    #elseif hxx_negative_unsafe_key
    // This deliberately weak value exists only to prove HXX rejects an unsafe
    // boundary before anything is emitted. Successful fixtures never use it.
    final unsafeKey: Dynamic = "unsafe";
    final value = <Button label="Save" key={unsafeKey} />;
    #elseif hxx_negative_event_target
    final value = <EventButton onClick={wrongEventTarget} />;
    #elseif hxx_negative_inherited_event_target
    final value = <EventButton onClick={wrongGeneralEventTarget} />;
    #elseif hxx_negative_optional_callback
    final value = <OptionalCallback onValue={requiresValue} />;
    #elseif hxx_negative_inherited_missing
    final value = <InheritedCard tone="warm" />;
    #elseif hxx_negative_nested_unsafe
    // This deliberately weak element type proves that a typed container does
    // not hide an unsafe value from HXX validation.
    final unsafeValues: Array<Dynamic> = ["unsafe"];
    final value = <StringList values={unsafeValues} />;
    #elseif hxx_negative_duplicate_prefix
    final value = <x-duplicate />;
    #end
  }
}
