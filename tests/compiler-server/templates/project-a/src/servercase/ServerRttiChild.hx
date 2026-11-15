package servercase;

#if server_rtti
/**
 * A subclass of an `@:rtti` class in another module. Haxe gives it an
 * `__rtti` string too, although it has no `@:rtti` itself, so the Genes
 * stamp must also stay out of its metadata.
 */
class ServerRttiChild extends ServerRtti {
  public function new() {}

  public function label(): Int {
    return 2;
  }
}
#end
