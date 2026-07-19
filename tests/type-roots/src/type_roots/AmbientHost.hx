package type_roots;

/**
 * Options loaded while Haxe types the ambient host declaration below.
 *
 * Generated source never names this record: the fixture reads only the host's
 * `ready` value. It therefore proves that a compiler-loaded typedef is not an
 * independent TypeScript output root.
 */
typedef IncidentalHostOptions = {
  final retries: Int;
}

/**
 * Minimal host-global extern used to exercise type-root ownership.
 *
 * Why: Haxe loads complete extern declarations during typing, including types
 * used by members that emitted code never accesses. Treating every loaded
 * typedef as a root publishes unrelated support modules.
 *
 * What: application code reads only `ready`; `configure` exists solely to make
 * `IncidentalHostOptions` part of the compiler's typed declaration inventory.
 *
 * How: `@:native` binds the extern to the ambient JavaScript value
 * `ambientHost`. It creates no generated class or module import.
 */
@:native("ambientHost")
extern class AmbientHost {
  public static final ready: Bool;
  public static function configure(options: IncidentalHostOptions): Void;
}
