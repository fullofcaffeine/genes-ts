package servercase;

/** Project A's nominal public value; project B reuses the module name. */
class SharedValue {
  public final label: String;

  public function new(label: String) {
    this.label = label;
  }
}
