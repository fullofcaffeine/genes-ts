package hxx_event_variance;

import genes.react.AnchorElement;
import genes.react.DomElement;
import genes.react.Element;
import genes.react.MouseEvent;
import genes.react.SyntheticEvent;

/**
 * Typed runtime import used only to turn the HXX value into stable test text.
 *
 * `@:jsRequire` produces the same `react-dom/server` ESM dependency in both
 * output profiles. The extern adds no class or wrapper at runtime.
 */
@:jsRequire("react-dom/server")
private extern class ReactDomServer {
  static function renderToStaticMarkup(element: Element): String;
}

/** General target in the fixture's ordinary Haxe class hierarchy. */
private class GeneralTarget {
  public final common: String;

  public function new(common: String) {
    this.common = common;
  }
}

/** More specific target whose extra field prevents structural equivalence. */
private class SpecificTarget extends GeneralTarget {
  public final specific: String;

  public function new(common: String, specific: String) {
    super(common);
    this.specific = specific;
  }
}

/** Generic target contract used to exercise nominal interface inheritance. */
private interface TargetView<T> {
  public function targetValue(): T;
}

/** Carries its type parameter through a real Haxe interface relation. */
private class GenericTarget<T> implements TargetView<T> {
  final value: T;

  public function new(value: T) {
    this.value = value;
  }

  public function targetValue(): T {
    return value;
  }
}

/** Fixes the inherited target contract to `String`. */
private class StringTarget extends GenericTarget<String> {
  public function new(value: String) {
    super(value);
  }
}

private typedef SpecificEventProps = {
  var onEvent: MouseEvent<SpecificTarget>->Void;
}

private typedef InterfaceEventProps = {
  var onEvent: MouseEvent<StringTarget>->Void;
}

/**
 * Proves that HXX accepts handlers able to receive every event React may send.
 *
 * Why: an anchor click supplies `MouseEvent<AnchorElement>`. A handler that
 * accepts the broader `SyntheticEvent<DomElement>` is safe: mouse events are
 * synthetic events, and anchors are DOM elements. HXX used to reject that
 * ordinary callback-subtyping relationship to avoid erasing React's generic
 * target type.
 *
 * What: the handlers below broaden the event family, the target element, both
 * at once, and the equivalent standard Haxe DOM element facade. Two component
 * examples also prove ordinary class and generic-interface inheritance.
 *
 * How: both output profiles render the elements without invoking the handlers.
 * The TypeScript lane also checks the emitted canonical React/DOM type names.
 */
class Main {
  static function EventSink(props: SpecificEventProps): Element {
    return <span>nominal target</span>;
  }

  static function InterfaceEventSink(props: InterfaceEventProps): Element {
    return <span>generic interface target</span>;
  }

  static function main(): Void {
    final broadFamilyAndTarget: SyntheticEvent<DomElement>->Void = event ->
      event.preventDefault();
    final broadTarget: MouseEvent<DomElement>->Void = event ->
      event.preventDefault();
    final broadFamily: SyntheticEvent<AnchorElement>->Void = event ->
      event.preventDefault();
    final standardBroadTarget: MouseEvent<js.html.Element>->Void = event ->
      event.preventDefault();
    final nominalBroadTarget: SyntheticEvent<GeneralTarget>->Void = event ->
      event.preventDefault();
    final interfaceBroadTarget: SyntheticEvent<TargetView<String>>->Void =
      event -> event.preventDefault();

    final html = ReactDomServer.renderToStaticMarkup(<div>
      <a onClick={broadFamilyAndTarget}>family and target</a>
      <a onClick={broadTarget}>target</a>
      <a onClick={broadFamily}>family</a>
      <a onClick={standardBroadTarget}>standard target</a>
      <EventSink onEvent={nominalBroadTarget} />
      <InterfaceEventSink onEvent={interfaceBroadTarget} />
    </div>);
    final expected = '<div><a>family and target</a><a>target</a>'
      + '<a>family</a><a>standard target</a>'
      + '<span>nominal target</span>'
      + '<span>generic interface target</span></div>';
    if (html != expected)
      throw 'Unexpected event-variance HTML: $html';
    trace(haxe.Json.stringify({html: html}));
  }
}
