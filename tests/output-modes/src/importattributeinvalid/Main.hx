package importattributeinvalid;

/**
 * Supplies deliberately malformed low-level import metadata to the paired
 * output-profile transaction test.
 *
 * Why: import attributes control how the JavaScript host loads a resource. A
 * typo must be diagnosed during dependency planning rather than silently
 * becoming an ordinary import that fails later at process startup.
 *
 * What/How: the test selects one invalid shape per compilation. The extern is
 * otherwise a normal `@:jsRequire` binding, so a compiler that mistakes the
 * metadata for "absent" will proceed far enough to publish incorrect output.
 */
#if import_attribute_nonliteral
@:genes.importAttributeType("j" + "son")
#elseif import_attribute_arity
@:genes.importAttributeType("json", "extra")
#elseif import_attribute_empty
@:genes.importAttributeType("")
#end
@:jsRequire("genes-invalid-import-attribute-fixture", "default")
extern class InvalidResource {
  static final value: String;
}

class Main {
  public static function main(): Void {
    trace(InvalidResource.value);
  }
}
