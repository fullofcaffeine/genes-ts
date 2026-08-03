package css_module_companions;

import genes.css.CssModule.imported;

/**
 * Exercises the public CSS Module workflow without introducing a framework.
 *
 * The stylesheet's real processor supplies the export names, Genes tooling
 * turns those names into `CardStyles`, and this function asks Genes to emit one
 * ordinary default import. Haxe checks each field before TypeScript or
 * JavaScript is generated.
 */
@:genes.moduleFunction("classNames")
function classNames(): String {
  final styles: CardStyles = imported("./card.module.css", "styles");
  return
    [styles.card, styles.title, styles.errorState, styles.element, styles.hxButton].join("|");
}

/** Exposes the closed style object so classic JavaScript declarations must preserve its type. */
@:genes.moduleFunction("exportedStyles")
function exportedStyles(): CardStyles {
  return imported("./card.module.css", "styles");
}
