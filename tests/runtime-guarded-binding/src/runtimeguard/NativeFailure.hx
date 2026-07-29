package runtimeguard;

/** Class catch used to prove native `instanceof` needs no identity assertion. */
class NativeFailure {
  public final message: String;

  public function new(message: String) {
    this.message = message;
  }
}
