package arrayindexstrict;

/**
 * Typed boundary for the Node console used by the differential transcript.
 *
 * Why: the fixture must execute unchanged through Genes and standard Haxe
 * without introducing a dynamic host escape hatch. What: this extern exposes
 * only the one console operation the proof needs. How: `@:native` binds the
 * class to Node's existing global and emits no runtime wrapper.
 */
@:native("console")
extern class NodeConsole {
  public static function log(message: String): Void;
}
