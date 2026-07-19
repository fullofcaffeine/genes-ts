import genes.react.AnchorElement;
import genes.react.ChangeEvent;
import genes.react.DomElement;
import genes.react.InputElement;
import genes.react.MouseEvent;
import genes.react.SyntheticEvent;

private interface TargetView<T> {
  public function targetValue(): T;
}

private class GenericTarget<T> implements TargetView<T> {
  final value: T;

  public function new(value: T) {
    this.value = value;
  }

  public function targetValue(): T {
    return value;
  }
}

private class StringTarget extends GenericTarget<String> {
  public function new(value: String) {
    super(value);
  }
}

private typedef InterfaceEventProps = {
  var onEvent: MouseEvent<StringTarget>->Void;
}

/**
 * Negative controls for directional React callback assignability.
 *
 * Each handler requires information React's selected property does not
 * promise. HXX must reject these cases before TypeScript or JavaScript output
 * is published; accepting one would make the broader positive rules unsound.
 */
class Invalid {
  static function needsAnchor(event: MouseEvent<AnchorElement>): Void {}

  static function needsMouse(event: MouseEvent<DomElement>): Void {}

  static function needsChange(event: ChangeEvent<DomElement>): Void {}

  static function needsInput(event: MouseEvent<InputElement>): Void {}

  static function needsWrongInterface(
      event: SyntheticEvent<TargetView<Int>>): Void {}

  static function InterfaceEventSink(
      props: InterfaceEventProps): genes.react.Element {
    return <span>interface event</span>;
  }

  static function main(): Void {
    #if hxx_event_narrow_target
    final value = <div onClick={needsAnchor}>narrow target</div>;
    #elseif hxx_event_narrow_family
    final value = <form onSubmit={needsMouse}>narrow family</form>;
    #elseif hxx_event_sibling_family
    final value = <button onClick={needsChange}>sibling family</button>;
    #elseif hxx_event_sibling_target
    final value = <a onClick={needsInput}>sibling target</a>;
    #elseif hxx_event_generic_interface_mismatch
    final value = <InterfaceEventSink onEvent={needsWrongInterface} />;
    #end
  }
}
