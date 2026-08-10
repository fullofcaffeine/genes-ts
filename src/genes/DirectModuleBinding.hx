package genes;

#if macro
import haxe.macro.Type;
import genes.Module.Field;

/**
 * Identifies fields that become direct ES-module bindings.
 *
 * Haxe stores module-level functions and values on a compiler-created class.
 * Genes removes that class only when every retained field has an explicit,
 * valid direct-binding request and the class has no initializer of its own.
 * The function and value plans still perform the complete validation.
 */
class DirectModuleBinding {
  public static final FUNCTION_METADATA = ':genes.moduleFunction';
  public static final VALUE_METADATA = ':genes.moduleValue';

  /** Returns the requested name without claiming that the request is valid. */
  public static function requestedName(field: ClassField): Null<String> {
    return requestedNameFromMetadata(field.meta);
  }

  /** Returns the requested name for a normalized emitter field. */
  public static function requestedNameFromField(field: Field): Null<String> {
    return field.meta == null ? null : requestedNameFromMetadata(field.meta);
  }

  /** Reads the two direct-binding annotations through their owning parsers. */
  public static function requestedNameFromMetadata(meta: MetaAccess): Null<String> {
    final functionName = ModuleFunctionPlan.requestedNameFromMetadata(meta);
    if (functionName != null)
      return functionName;
    return ModuleValuePlan.requestedNameFromMetadata(meta);
  }

  /** True when the field has a syntactically valid direct-binding request. */
  public static function isSelected(field: Field): Bool {
    return requestedNameFromField(field) != null;
  }

  /** True only for Haxe's compiler-created module-fields owner. */
  public static function isModuleFieldsOwner(owner: ClassType): Bool {
    return ModuleFunctionPlan.isModuleFieldsOwner(owner);
  }

  /**
   * Reports whether the compiler-created owner has no remaining runtime job.
   *
   * A hidden module initializer belongs to the owner even though it is not in
   * the visible field list. Genes keeps the owner when that initializer exists.
   */
  public static function canOmitSyntheticOwner(owner: ClassType,
      fields: Array<Field>): Bool {
    if (!isModuleFieldsOwner(owner) || owner.init != null)
      return false;
    final retained = Module.emittableFields(fields);
    return retained.length > 0
      && retained.filter(field -> !isSelected(field)).length == 0;
  }
}
#end
