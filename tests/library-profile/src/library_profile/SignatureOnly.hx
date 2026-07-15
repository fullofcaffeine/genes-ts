package library_profile;

/**
 * A concrete public type reached only through `LibraryApi` method signatures.
 *
 * The library profile must emit this class and its public methods as both JS
 * and declarations. The default application profile must leave it absent.
 */
class SignatureOnly {
  public final label:String;

  public function new(label:String) {
    this.label = label;
  }

  public function upper():String {
    return label.toUpperCase();
  }

  private function secret():String {
    return "secret";
  }
}
