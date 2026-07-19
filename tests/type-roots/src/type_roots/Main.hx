package type_roots;

/**
 * Contrasts a real type annotation with an incidental ambient-extern type.
 */
class Main {
  static function main(): Void {
    if (AmbientHost.ready)
      trace(render({label: "typed-root"}));
  }

  static function render(named: NamedContract): String {
    return named.label;
  }
}
