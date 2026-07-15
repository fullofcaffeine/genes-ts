package package_shapes;

/** Stable, fully typed runtime transcript shared by both Genes profiles. */
typedef PackageShapeTranscript = {
  final version: String;
  final label: String;
  final closed: String;
}

/**
 * Exercises a CommonJS `export =` constructor as both a value and a field type.
 *
 * The public field forces the imported extern into generated TS and classic
 * declaration type positions. Construction and method access then prove that
 * the type-only projection does not alter either runtime output profile.
 */
class Main {
  public final driver: ExportEqualsConstructor;

  public function new(label: String) {
    driver = new ExportEqualsConstructor(label);
  }

  public function current(): ExportEqualsConstructor {
    return driver;
  }

  public function transcript(): PackageShapeTranscript {
    final currentDriver = current();
    return {
      version: ExportEqualsConstructor.version,
      label: currentDriver.label,
      closed: currentDriver.close()
    };
  }

  public static function main(): Void {
    js.Node.console.log(haxe.Json.stringify(new Main("genes").transcript()));
  }
}
