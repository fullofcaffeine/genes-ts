package servercase;

#if server_intrinsic_provider
import genes.react.Node;
import servercase.IntrinsicPings;

typedef BoxProps = {
  @:optional var onPing: PingA->Void;
  @:optional var children: Node;
}

/**
 * A custom intrinsic provider that two modules use (genes-gz0l).
 *
 * Why: `JsxContext` shares the contract of one intrinsic tag between the
 * modules of a compilation. Each module must still depend on this module,
 * so that a compilation server types both `IntrinsicCompA` and
 * `IntrinsicCompB` again when the test changes `onPing` to `PingB->Void`.
 */
extern class IntrinsicProvider {
  @:genes.jsxIntrinsic("x-box")
  public static var box: BoxProps;
}
#end
