package genes;

#if macro
import haxe.macro.Type;
import genes.Module.Field;

/**
 * Identifies fields that deliberately become direct ES-module bindings.
 *
 * Why: Haxe represents genuine top-level functions and values as static fields
 * on a compiler-synthetic `KModuleFields` class. Genes must recognize both
 * lowering contracts before dependency aliases, registration, or either
 * output profile decides whether that synthetic owner still has runtime work.
 *
 * What/How: this helper reads only syntactically valid metadata. The dedicated
 * function/value plans still own complete validation and source diagnostics.
 * Keeping this small shared predicate prevents the dependency graph and
 * emitters from developing subtly different definitions of a direct binding.
 */
class DirectModuleBinding {
  public static final FUNCTION_METADATA = ':genes.moduleFunction';
  public static final VALUE_METADATA = ':genes.moduleValue';

  /** Returns the selected direct binding, without performing full validation. */
  public static function requestedName(field: ClassField): Null<String> {
    return requestedNameFromMetadata(field.meta);
  }

  /** Same lookup for Genes' normalized emitter field. */
  public static function requestedNameFromField(field: Field): Null<String> {
    return field.meta == null ? null : requestedNameFromMetadata(field.meta);
  }

  /** Metadata-only lookup used before complete per-module plans are available. */
  public static function requestedNameFromMetadata(meta: MetaAccess): Null<String> {
    final functionName = ModuleFunctionPlan.requestedNameFromMetadata(meta);
    if (functionName != null)
      return functionName;
    return ModuleValuePlan.requestedNameFromMetadata(meta);
  }

  /** Whether one retained field has either valid direct-binding marker. */
  public static function isSelected(field: Field): Bool {
    return requestedNameFromField(field) != null;
  }

  /** True only for Haxe's synthetic owner of genuine module-level fields. */
  public static function isModuleFieldsOwner(owner: ClassType): Bool {
    return ModuleFunctionPlan.isModuleFieldsOwner(owner);
  }

  /**
   * Whether every retained field can exist without Haxe's synthetic owner.
   *
   * A module-value marker deliberately starts with this all-direct contract.
   * It prevents reordering a selected initializer around an ordinary synthetic
   * owner field. Function-only owners keep the same result they had before
   * module values existed.
   */
  public static function canOmitSyntheticOwner(owner: ClassType,
      fields: Array<Field>): Bool {
    if (!isModuleFieldsOwner(owner))
      return false;
    final retained = Module.emittableFields(fields);
    return retained.length > 0
      && retained.filter(field -> !isSelected(field)).length == 0;
  }
}
#end
