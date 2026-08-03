package css_module_companions;

import genes.css.CssModule.imported;

/** Small negative cases that keep each public error message independently live. */
class Invalid {
  static function main(): Void {
    #if css_module_missing_field
    final styles: CardStyles = imported("./card.module.css");
    trace(styles.missing);
    #elseif css_module_no_type
    final styles = imported("./card.module.css");
    trace(styles);
    #elseif css_module_wrong_request
    final styles: CardStyles = imported("./other.module.css");
    trace(styles.card);
    #elseif css_module_wrong_owner
    final styles: WrongOwnerStyles = imported("./card.module.css");
    trace(styles.card);
    #elseif css_module_unmarked_type
    final styles: UnmarkedStyles = imported("./card.module.css");
    trace(styles.card);
    #elseif css_module_nonliteral
    final request = "./card.module.css";
    final styles: CardStyles = imported(request);
    trace(styles.card);
    #end
  }
}

@:genes.cssModuleCompanion("css_module_companions.SomeOtherModule",
  "./card.module.css",
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
private typedef WrongOwnerStyles = {
  final card: String;
}

private typedef UnmarkedStyles = {
  final card: String;
}
