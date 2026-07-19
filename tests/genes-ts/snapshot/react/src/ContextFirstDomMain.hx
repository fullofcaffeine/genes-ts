import genes.react.Element;

/**
 * Proves HXX can load the complete DOM callback type itself.
 *
 * Why: `Main` deliberately names `js.html.AnchorElement` before its first HXX
 * callback. That covers one Haxe module-load order, but it would not catch a
 * projection that works only after another source expression loaded the DOM
 * extern first.
 *
 * What/How: this program never names a `js.html` type. Contextual HXX typing
 * must load the anchor contract, accept APIs missing from Genes' small
 * compatibility facade, and still let generated TSX use the ambient browser
 * identity instead of publishing Genes-owned DOM modules.
 */
class ContextFirstDomMain {
  static function main(): Void {
    final element: Element = <a onClick={event -> {
      event.currentTarget.protocol = "https:";
      event.currentTarget.focus();
    }}>Context first</a>;
    trace(element);
  }
}
