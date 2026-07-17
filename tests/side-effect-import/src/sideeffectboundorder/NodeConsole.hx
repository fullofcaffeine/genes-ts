package sideeffectboundorder;

/** Typed binding to the host console used by the runtime order transcript. */
@:native("console")
extern class NodeConsole {
  public static function log(message:String):Void;
}
