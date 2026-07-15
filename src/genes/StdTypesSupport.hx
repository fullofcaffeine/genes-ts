package genes;

/**
 * Defines host-library declaration gaps shared by both Genes output profiles.
 *
 * Why:
 * Haxe 4.3.7's JavaScript externs still expose a few historical Mozilla
 * WebIDL names that are absent from TypeScript's `lib.dom.d.ts`. Generated
 * TypeScript and classic JavaScript declarations must agree on those names;
 * otherwise the same Haxe program has a valid TS profile but an unusable
 * classic declaration tree under `skipLibCheck: false`.
 *
 * What:
 * This module owns only the narrow, structural ambient declarations needed to
 * bridge that host-library mismatch. Runtime metadata augmentations remain in
 * the TS support emitter because classic JavaScript erases them.
 *
 * How:
 * Target printers call `emitWebIdlGaps` inside their own `declare global`
 * block. Keeping the facts here prevents profile-specific copies from
 * drifting while leaving file layout and surrounding syntax to each printer.
 */
class StdTypesSupport {
  /**
   * Emits the shared WebIDL declarations at the requested indentation.
   *
   * The declarations intentionally use ambient `var` values. Multiple
   * generated packages can contribute identical global `var` declarations to
   * one TypeScript program, while duplicate global `const` declarations would
   * fail with TS2451. No index signature or broad escape type is introduced.
   */
  public static function emitWebIdlGaps(writer: Writer,
      indent = '  '): Void {
    writer.write('${indent}interface PositionError { readonly code: number; readonly message: string }\n');
    writer.write('${indent}var PositionError: { readonly PERMISSION_DENIED: 1; readonly POSITION_UNAVAILABLE: 2; readonly TIMEOUT: 3; readonly prototype: PositionError };\n');
    writer.write('${indent}interface FetchObserver { readonly state: "requesting" | "responding" | "aborted" | "errored" | "complete"; onstatechange: Function; onrequestprogress: Function; onresponseprogress: Function }\n');
    writer.write('${indent}var FetchObserver: { readonly prototype: FetchObserver };\n');
  }

  /**
   * Appends a self-contained ambient block to classic `StdTypes.d.ts`.
   *
   * Classic declaration emission already makes `StdTypes.d.ts` an external
   * module through its exported structural types, so `declare global` is the
   * correct merge-safe form and needs no synthetic runtime import or value.
   */
  public static function emitClassicGlobalBlock(writer: Writer): Void {
    writer.write('\ndeclare global {\n');
    emitWebIdlGaps(writer);
    writer.write('}\n');
  }
}
