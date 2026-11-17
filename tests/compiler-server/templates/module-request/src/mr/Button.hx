package mr;

/** A leaf-like module with private helpers that dead-code elimination sees. */
class Button {
  public static function render(): String {
    return label() + ':' + helper();
  }

  static function label(): String {
    return 'Save';
  }

  static function helper(): String {
    return Theme.color();
  }

  static function unused(): String {
    return 'never called';
  }
}
