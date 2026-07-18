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
#if (import_attribute_arity || import_attribute_nonliteral || import_attribute_empty)
@:jsRequire("genes-invalid-import-attribute-fixture", "default")
extern class InvalidResource {
  static final value: String;
}
#elseif import_attribute_same_alias_conflict
@:jsRequire("genes-invalid-import-attribute-fixture", "default")
@:genes.importAttributeType("json")
@:genes.importAlias("SharedResource")
extern class FirstConflictingResource {
  static final value:String;
}

@:jsRequire("genes-invalid-import-attribute-fixture", "default")
@:genes.importAttributeType("file")
@:genes.importAlias("SharedResource")
extern class SecondConflictingResource {
  static final value:String;
}
#elseif import_attribute_distinct_alias_conflict
@:jsRequire("genes-invalid-import-attribute-fixture", "default")
@:genes.importAttributeType("json")
@:genes.importAlias("JsonResource")
extern class FirstConflictingResource {
  static final value:String;
}

@:jsRequire("genes-invalid-import-attribute-fixture", "default")
@:genes.importAttributeType("file")
@:genes.importAlias("FileResource")
extern class SecondConflictingResource {
  static final value:String;
}
#end

class Main {
  public static function main(): Void {
    #if (import_attribute_same_alias_conflict || import_attribute_distinct_alias_conflict)
    trace(FirstConflictingResource.value);
    trace(SecondConflictingResource.value);
    #else
    trace(InvalidResource.value);
    #end
  }
}
