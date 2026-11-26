package servercase;

#if server_intrinsic_provider
import genes.react.Element;
import servercase.IntrinsicPings;

/** Uses the `x-box` tag of `IntrinsicProvider`; see that module. */
class IntrinsicCompB {
  public static function render(): Element {
    return <x-box onPing={e -> IntrinsicSink.take(e.a)}>comp-B</x-box>;
  }
}
#end
