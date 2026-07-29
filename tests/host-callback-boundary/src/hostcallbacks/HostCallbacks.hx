package hostcallbacks;

import js.hostcallbacks.TypedHostCallbacks;
import js.hostcallbacks.OpaqueHostCallbacks;
import js.hostcallbacks.OverriddenHostCallbacks;

/**
 * A normal Haxe property that happens to use the same opaque Function type as
 * old WebIDL externs. It is not a JavaScript host declaration.
 */
@:keep
class UserCallbacks {
  public var onerror: haxe.Constraints.Function;

  public function new() {}
}

/**
 * Exercises native and user-owned callback assignments without depending on
 * Tink or any downstream application type.
 */
@:keep
class HostCallbacks {
  /**
   * Haxe accepts this because FileReader.onerror is the opaque
   * haxe.Constraints.Function. TypeScript's DOM library instead expects
   * ProgressEvent<FileReader>, so generated TS needs the property's own type.
   */
  public static function assignFileReaderError(reader: js.html.FileReader): Void {
    reader.onerror = function(error: js.lib.Error): Void {
      final _ = error.message;
    };
  }

  /**
   * The receiver is a call, not a stable TypeScript type-query entity name.
   * This callback accepts Dynamic, so TypeScript needs no assertion.
   */
  public static function assignTemporaryReader(): Void {
    makeReader().onerror = function(_: Dynamic): Void {};
  }

  /**
   * A concrete native callback is already represented precisely and must stay
   * a direct assignment.
   */
  public static function assignConcreteHost(target: TypedHostCallbacks): Void {
    target.onready = function(_: String): Void {};
  }

  /**
   * A nullable local is not a legal bare TypeScript type-query receiver. The
   * ambient test declaration already accepts this concrete callback.
   */
  public static function assignNullableHost(target: Null<OpaqueHostCallbacks>): Void {
    target.onready = function(_: String): Void {};
  }

  /** Authored TypeScript field projections take precedence over this plan. */
  public static function assignOverriddenHost(target: OverriddenHostCallbacks): Void {
    target.onnumber = function(_: Int): Void {};
    target.ontext = function(_: String): Void {};
  }

  /** A same-shaped user property must never receive the native-host bridge. */
  public static function assignUser(target: UserCallbacks,
      sink: String->Void): Void {
    target.onerror = function(value: String): Void {
      sink(value);
    };
  }

  static function makeReader(): js.html.FileReader {
    return new js.html.FileReader();
  }
}

#if host_callback_nullable_inline_negative
/**
 * Negative control for the interaction between inlining and host callbacks.
 *
 * Haxe inlines `installBuilt` and records the generated `_this` binding as
 * nullable even though the individual receiver read is retagged non-null.
 * Genes may emit `_this!.onerror` in value code, but it must not construct the
 * invalid TypeScript type query `typeof _this!.onerror`.
 */
@:keep
private class NullableReaderHolder {
  final target: Null<ReaderWithInline>;

  public function new(target: Null<ReaderWithInline>) {
    this.target = target;
  }

  public function install(): Void {
    target.installBuilt(buildMarker());
  }

  static function buildMarker(): Int {
    return 1;
  }
}

private class ReaderWithInline extends js.html.FileReader {
  public function new() {
    super();
  }

  public inline function installBuilt(_: Int): Void {
    this.onerror = function(error: js.lib.Error): Void {
      final _ = error.message;
    };
  }
}
#end
