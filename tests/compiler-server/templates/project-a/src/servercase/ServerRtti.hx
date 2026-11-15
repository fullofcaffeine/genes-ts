package servercase;

#if server_rtti
/**
 * A class with runtime type information. Haxe prints its metadata into
 * `__rtti`, so a Genes stamp that holds the request number must not be part
 * of that metadata: the number differs between a cold build and a warm
 * compilation server.
 */
@:rtti
class ServerRtti {
  public static function value(): Int {
    return 1;
  }
}
#end
