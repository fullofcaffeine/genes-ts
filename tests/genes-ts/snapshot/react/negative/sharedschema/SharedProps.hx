package sharedschema;

/**
 * Has the same declared name as `SharedSchemaElements.SharedProps`.
 *
 * The two typedefs live in different Haxe modules and accept different
 * properties. A tag that uses this one must never receive the other schema.
 */
typedef SharedProps = {
  final count: Int;
}
