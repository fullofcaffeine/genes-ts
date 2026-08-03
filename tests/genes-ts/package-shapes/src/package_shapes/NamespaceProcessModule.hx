package package_shapes;

/**
 * Models a JavaScript module object whose function returns a named class.
 *
 * Why: many Haxe extern libraries represent a whole JavaScript module with a
 * one-argument `@:jsRequire`, then place its returned instance types beside the
 * module owner in the same `.hx` file. The module object and the returned class
 * need different TypeScript imports even though Haxe keeps them together.
 *
 * What/How: `NamespaceProcessModule` owns runtime calls through a namespace
 * import. The metadata-free secondary `NamespaceProcess` denotes the package's
 * named class in generated type positions.
 */
@:jsRequire("genes-namespace-secondary-fixture")
extern class NamespaceProcessModule {
  static function spawn(label: String): NamespaceProcess;
}

/** The precise instance returned by `NamespaceProcessModule.spawn`. */
extern class NamespaceProcess {
  final label: String;
  function close(): String;
}
