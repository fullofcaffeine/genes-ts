package genes;

#if macro
import haxe.macro.Type;
import genes.Module.Field;
import genes.BindingIdentity.StaticFieldOriginKey;
import genes.ModuleFunctionPlan.ModuleFunctionEntry;

using Lambda;

/**
 * Owns intrinsic direct-function requests before imports or locals are named.
 *
 * Why: dependency planning, import allocation, local naming, and lazy-import
 * setup all need to know that one exact retained Haxe field will become a
 * fixed ESM binding. The final `ModuleFunctionPlan` is intentionally built
 * later, after aliasable names exist, so asking it for this fact would invert
 * the planning order.
 *
 * What: this request-local plan validates metadata, owner/field shape, public
 * name agreement, and lexical relocatability. Each entry carries one exact
 * `StaticFieldOriginKey` plus the requested emitted binding.
 *
 * How: build from retained typed module members only. Later plans consume
 * these immutable entries and add their own collision policy; no emitter or
 * dependency collector reparses metadata to rediscover selection.
 */
class ModuleFunctionRequestPlan {
  final module: Module;
  final entries: Array<ModuleFunctionEntry>;
  final candidates: Array<StaticFieldOriginKey>;
  var complete: Null<Array<ModuleFunctionEntry>>;

  public static function build(module: Module): ModuleFunctionRequestPlan {
    ModuleFunctionPlan.rejectDeferredModuleValues(module);
    final entries: Array<ModuleFunctionEntry> = [];
    final candidates: Array<StaticFieldOriginKey> = [];
    for (member in module.members) {
      switch member {
        case MClass(owner, _, fields):
          for (field in Module.emittableFields(fields)) {
            final metadata = field.meta == null ? [] : field.meta.extract(':genes.moduleFunction');
            if (metadata.length == 0)
              continue;
            candidates.push(new StaticFieldOriginKey(owner.module, owner.name,
              field.name));
            // Source-module bindings are needed before imports and locals are
            // named. Class-static compatibility requests own no early binding,
            // so validate them only after executable template/JSX plans.
            if (!ModuleFunctionPlan.isModuleFieldsOwner(owner))
              continue;
            final exposeMetadata = field.meta == null ? [] : field.meta.extract(':expose');
            entries.push(ModuleFunctionPlan.parseRequest(owner, field,
              metadata, fields, exposeMetadata));
          }
        case MEnum(_, _) | MType(_, _) | MMain(_):
      }
    }
    return new ModuleFunctionRequestPlan(module, entries, candidates);
  }

  /**
   * Canonically validates one exact typed static field before Modules exist.
   *
   * Macro expansion for `Genes.dynamicImport` runs before generator modules
   * and their request plans are available. It may use this adapter, which
   * normalizes the exact typed owner once and delegates to the same intrinsic
   * parser as `build`; no macro-specific metadata interpretation is allowed.
   */
  public static function fromTypedField(ownerRef: Ref<ClassType>,
      fieldRef: Ref<ClassField>): Null<ModuleFunctionEntry> {
    return fromTypedFieldValues(ownerRef.get(), fieldRef.get());
  }

  /** Value adapter for compiler APIs that expose exact typed fields, not refs. */
  public static function fromTypedFieldValues(owner: ClassType,
      sourceField: ClassField): Null<ModuleFunctionEntry> {
    if (!sourceField.meta.has(':genes.moduleFunction'))
      return null;
    final fields = Module.fieldsOf(owner);
    final field = fields.find(candidate -> candidate.isStatic
      && candidate.name == sourceField.name);
    if (field == null) {
      return CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-OWNER-007: '
        + '@:genes.moduleFunction on ${owner.name}.${sourceField.name} did '
        + 'not resolve to one retained normalized static field',
        sourceField.pos);
    }
    return ModuleFunctionPlan.parseRequest(owner, field,
      sourceField.meta.extract(':genes.moduleFunction'), fields,
      sourceField.meta.extract(':expose'));
  }

  public function new(module: Module, entries: Array<ModuleFunctionEntry>,
      candidates: Array<StaticFieldOriginKey>) {
    this.module = module;
    this.entries = entries.copy();
    this.candidates = candidates.copy();
  }

  /** Returns entries in retained source order. */
  public function allEntries(): Array<ModuleFunctionEntry> {
    return entries.copy();
  }

  /**
   * Completes class-static requests during implementation preflight.
   *
   * Keeping this operation on the request plan preserves one canonical
   * authority while retaining diagnostic order: malformed executable template
   * or JSX carriers fail before an unrelated class-static shape request.
   */
  public function completeEntries(): Array<ModuleFunctionEntry> {
    if (complete != null)
      return complete.copy();
    final result = entries.copy();
    for (member in module.members) {
      switch member {
        case MClass(owner, _, fields)
          if (!ModuleFunctionPlan.isModuleFieldsOwner(owner)):
          for (field in Module.emittableFields(fields)) {
            if (!hasCandidate(owner, field))
              continue;
            final metadata = field.meta == null ? [] : field.meta.extract(':genes.moduleFunction');
            final exposeMetadata = field.meta == null ? [] : field.meta.extract(':expose');
            result.push(ModuleFunctionPlan.parseRequest(owner, field,
              metadata, fields, exposeMetadata));
          }
        case MClass(_, _, _) | MEnum(_, _) | MType(_, _) | MMain(_):
      }
    }
    complete = result;
    return result.copy();
  }

  /** True for an exact retained marker even when validation is deliberately late. */
  public function hasCandidate(owner: ClassType, field: Field): Bool {
    final origin = new StaticFieldOriginKey(owner.module, owner.name,
      field.name);
    return candidates.exists(candidate -> candidate.equals(origin));
  }

  /** Resolves one normalized retained field by exact owner/field identity. */
  public function entryFor(owner: ClassType,
      field: Field): Null<ModuleFunctionEntry> {
    final origin = new StaticFieldOriginKey(owner.module, owner.name,
      field.name);
    return entryForOrigin(origin);
  }

  /** Resolves one compiler-visible static field origin. */
  public function entryForOrigin(origin: StaticFieldOriginKey): Null<ModuleFunctionEntry> {
    for (entry in entries)
      if (entry.origin.equals(origin))
        return entry;
    return null;
  }
}
#end
