package genes.ts;

import haxe.DynamicAccess;

/**
 * Read-only, string-indexed view of a non-null, non-array JavaScript object.
 *
 * genes-ts emits this as `Readonly<Record<string, unknown>>`. This is a broad
 * "record-like object" proof, not a plain-prototype or schema proof: dates,
 * class instances, and host objects may still pass the corresponding
 * `UnknownNarrow.record` guard. Domain code should decode known fields into
 * precise records or maps before storing them.
 */
@:ts.type("Readonly<Record<string, unknown>>")
abstract UnknownRecord(DynamicAccess<Unknown>) {
  /**
   * Returns true when `name` is an own property of the record.
   *
   * Use this before `get` when missing and own-undefined need to be
   * distinguished. The call-form avoids false negatives when a value shadows
   * `hasOwnProperty` and works for null-prototype objects.
   */
  public inline function hasOwn(name: String): Bool {
    return js.Syntax.code("Object.prototype.hasOwnProperty.call({0}, {1})",
      this, name);
  }

  /**
   * Reads an own-property value as `Unknown`.
   *
   * Missing fields intentionally produce runtime `undefined` wrapped as
   * `Unknown`; TypeScript's `unknown` absorbs `undefined`, so callers that care
   * about presence must call `hasOwn` separately.
   */
  public inline function get(name: String): Unknown {
    return
      Unknown.fromBoundary(js.Syntax.code("Object.prototype.hasOwnProperty.call({0}, {1}) ? {0}[{1}] : undefined",
      this, name));
  }

  /**
   * Returns own enumerable string keys, matching `Object.keys`.
   *
   * Symbols and non-enumerable properties are excluded. Validation is not a
   * sandbox: getters or proxies can still execute when JavaScript itself would
   * execute them.
   */
  public inline function keys(): Array<String> {
    return js.Syntax.code("Object.keys({0})", this);
  }
}
