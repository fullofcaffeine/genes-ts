package genes.ts;

import genes.Writer;

/**
 * Emits the TypeScript support module shared by generated genes-ts output.
 *
 * The artifact intentionally remains `StdTypes.ts`: downstream projects already
 * import and include it. This emitter owns the TypeScript-target declarations
 * that describe Haxe structural std types, Haxe JS runtime metadata on built-in
 * globals, small WebIDL gaps, and value-level compatibility stubs.
 */
class StdTypesEmitter {
  final writer: Writer;

  public static function emit(path: String): Void {
    final emitter = new StdTypesEmitter(Writer.bufferedFileWriter(path));
    emitter.emitModule();
  }

  function new(writer: Writer) {
    this.writer = writer;
  }

  function emitModule(): Void {
    emitCoreStructuralTypes();
    emitGlobalAugmentations();
    emitValueLevelCompatibilityStubs();
    writer.close();
  }

  function emitCoreStructuralTypes(): Void {
    writer.write('export type Iterator<T> = { hasNext(): boolean; next(): T };\n');
    // Haxe/JS stdlib uses `__name__` both as a marker (`true`) and as a
    // human-readable name (e.g. `"String"`).
    writer.write('export type HxRuntimeName = string | boolean;\n');
    // Map keys in Haxe can be primitives or objects. We avoid `any`/`unknown`
    // here to keep non-runtime output strongly typed under the typing policy.
    writer.write('export type HxMapKey = string | number | boolean | symbol | object | null;\n');
    // Haxe `Iterable<T>` is structural: anything with `iterator(): Iterator<T>`.
    // Arrays are also valid iterables in Haxe.
    // In genes-ts we also treat `haxe.Constraints.IMap`-like shapes as iterable
    // over values (via `keys()` + `get()`), even when DCE removes an explicit
    // `iterator()` method.
    writer.write('export type Iterable<T> = { iterator(): Iterator<T> } | { keys(): Iterator<HxMapKey>; get(k: HxMapKey): T | null } | Array<T>;\n');
    writer.write('export type KeyValueIterator<K, V> = Iterator<{ key: K; value: V }>;\n');
    writer.write('export type KeyValueIterable<K, V> = { keyValueIterator(): KeyValueIterator<K, V> };\n');
    writer.write('export interface ArrayAccess<T> {}\n');
  }

  function emitGlobalAugmentations(): Void {
    writer.write('declare global {\n');
    emitHaxeRuntimeGlobalAugmentations();
    emitWebIdlGaps();
    writer.write('}\n');
  }

  function emitHaxeRuntimeGlobalAugmentations(): Void {
    // Haxe JS boot code mutates only these built-ins today; keep this list
    // narrow instead of augmenting broad globals such as Function or Object.
    writer.write('  interface StringConstructor { __name__?: HxRuntimeName }\n');
    writer.write('  interface String { __class__?: Function }\n');
    writer.write('  interface ArrayConstructor { __name__?: HxRuntimeName }\n');
    writer.write('  interface DateConstructor { __name__?: HxRuntimeName }\n');
    writer.write('  interface Date { __class__?: Function }\n');
  }

  function emitWebIdlGaps(): Void {
    // Some Haxe JS externs are generated from Mozilla WebIDL and are not part of
    // TypeScript's standard `lib.dom.d.ts` surface. Provide minimal global types
    // so generated TS can type-check under `skipLibCheck: false`.
    writer.write('  interface PositionError { readonly code: number; readonly message: string }\n');
    writer.write('  const PositionError: { readonly PERMISSION_DENIED: 1; readonly POSITION_UNAVAILABLE: 2; readonly TIMEOUT: 3; readonly prototype: PositionError };\n');
    writer.write('  interface FetchObserver { readonly state: "requesting" | "responding" | "aborted" | "errored" | "complete"; onstatechange: Function; onrequestprogress: Function; onresponseprogress: Function }\n');
    writer.write('  const FetchObserver: { readonly prototype: FetchObserver };\n');
  }

  function emitValueLevelCompatibilityStubs(): Void {
    // These value-level stubs exist for compatibility with Haxe reflection-ish
    // patterns, but they do not carry meaningful runtime values in JS.
    writer.write('export const Iterator: null = null;\n');
    writer.write('export const Iterable: null = null;\n');
    writer.write('export const KeyValueIterator: null = null;\n');
    writer.write('export const KeyValueIterable: null = null;\n');
    writer.write('export const ArrayAccess: null = null;\n');
  }
}
