package package_shapes.dropdown_menu;

/**
 * The `Menu` member below the named `Dropdown` export.
 *
 * Genes imports only the `Dropdown` root. It must first resolve that root's
 * collision-safe local, then append `.Menu` for constructor and type access.
 */
@:jsRequire("genes-binding-identity-fixture", "Dropdown.Menu")
extern class Menu {
  public function new();
  public function marker(): String;
}
