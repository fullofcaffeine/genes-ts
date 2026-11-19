package inc;

/** Review probe: an extern class with __init__ (Genes warns with -D genes.extern_init_warning). */
@:native("Object")
extern class RvExtInit {
  static function __init__(): Void {
    js.Syntax.code("void 0");
  }

  static function keys(value: {}): Array<String>;
}
