package module_functions;

final class TopLevelReceiver {
  final stored: Int;

  public function new(stored: Int) {
    this.stored = stored;
  }

  public function value(): Int {
    return stored;
  }
}
