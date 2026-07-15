package library_profile;

/**
 * Exposed root for the reusable-library profile regression corpus.
 *
 * Why: Haxe's normal application DCE is free to remove methods no Haxe
 * expression calls. A reusable library must instead keep the external runtime
 * and declaration contracts selected for JavaScript consumers in lockstep.
 *
 * What: the root export remains compact in the default profile and retains its
 * complete public surface under `-D genes.library`.
 *
 * How: `@:genes.library` is inert without `-D genes.library`. Under the define,
 * Genes captures this class before DCE, retains its public graph, and emits a
 * root ESM re-export. Unlike `@:expose`, the metadata does not change ordinary
 * application builds, which is what lets this fixture prove graceful DCE.
 */
@:genes.library
class LibraryApi {
  public function new() {}

  /** Forces a signature-only class into the reusable public graph. */
  public function roundTrip(value:SignatureOnly):SignatureOnly {
    return value;
  }

  /** Exercises generic abstract instance and true-static helper ownership. */
  public function first<T>(values:Array<T>):Null<T> {
    final view = new GenericView<T>(values);
    return GenericView.version() == "v1" ? view.first() : null;
  }

  private function implementationDetail():String {
    return "private";
  }
}
