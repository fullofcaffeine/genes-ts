package genes;

#if macro
import haxe.macro.Expr.MetadataEntry;
import haxe.macro.Expr.Position;
import haxe.macro.Type;
import genes.Module.Field;
import genes.ModuleFunctionPlan.ModuleBindingFact;
import genes.util.TypeUtil;

/** One validated top-level Haxe value emitted as a direct ESM `const`. */
class ModuleValueEntry {
  public final owner: ClassType;
  public final field: Field;
  public final requestedName: String;
  public final requestedPos: Position;

  public function new(owner: ClassType, field: Field, requestedName: String,
      requestedPos: Position) {
    this.owner = owner;
    this.field = field;
    this.requestedName = requestedName;
    this.requestedPos = requestedPos;
  }
}

/**
 * Validates opt-in direct lowering for genuine Haxe module-level values.
 *
 * `@:genes.moduleValue("name")` is deliberately framework-neutral. It turns
 * one retained, public, immutable top-level Haxe value into the corresponding
 * `export const name` in TypeScript and classic JavaScript. Typed references
 * in the same or another Haxe module resolve to that exact ESM binding.
 *
 * The initial contract accepts only Haxe's synthetic `KModuleFields` owner and
 * requires every retained field on that owner to be a selected module function
 * or module value. That narrow rule lets Genes remove the owner completely,
 * preserves initializer order, and avoids inventing reflection semantics for a
 * compiler-only class. Metadata is inspected after Haxe DCE and never roots a
 * value by itself.
 */
class ModuleValuePlan {
  public static final METADATA = ':genes.moduleValue';

  final entries: Array<ModuleValueEntry>;

  public static function requestedName(field: ClassField): Null<String> {
    return requestedNameFromMetadata(field.meta);
  }

  public static function requestedNameFromMetadata(meta: MetaAccess): Null<String> {
    final entries = meta.extract(METADATA);
    return switch entries {
      case [{params: [{expr: EConst(CString(value))}]}]
        if (value.length > 0 && IdentifierPolicy.isValidModuleBinding(value)):
        value;
      default:
        null;
    }
  }

  public static function build(module: Module): ModuleValuePlan {
    final bindings = ModuleFunctionPlan.bindingInventory(module);
    // Functions and values share one lexical ESM namespace even though their
    // complete shape validation belongs to separate focused plans.
    for (member in module.members) {
      switch member {
        case MClass(owner, _, fields):
          for (field in Module.emittableFields(fields)) {
            if (field.meta == null)
              continue;
            final requested = ModuleFunctionPlan.requestedNameFromMetadata(field.meta);
            if (requested != null)
              bindings.push({
                name: requested,
                kind: 'direct module function ${owner.name}.${field.name}',
                pos: field.pos
              });
          }
        case MEnum(_, _) | MType(_, _) | MMain(_):
      }
    }

    final result: Array<ModuleValueEntry> = [];
    for (member in module.members) {
      switch member {
        case MClass(owner, _, fields):
          for (field in Module.emittableFields(fields)) {
            final metadata = field.meta == null ? [] : field.meta.extract(METADATA);
            if (metadata.length == 0)
              continue;
            final entry = parseAndValidate(owner, field, fields, metadata,
              bindings, module);
            result.push(entry);
            bindings.push({
              name: entry.requestedName,
              kind: 'direct module value ${owner.name}.${field.name}',
              pos: entry.requestedPos
            });
          }
        case MEnum(_, _) | MType(_, _) | MMain(_):
      }
    }
    return new ModuleValuePlan(result);
  }

  public function new(entries: Array<ModuleValueEntry>) {
    this.entries = entries.copy();
  }

  public function entriesFor(owner: ClassType): Array<ModuleValueEntry> {
    return entries.filter(entry -> sameOwner(entry.owner, owner));
  }

  public function entryFor(owner: ClassType,
      field: Field): Null<ModuleValueEntry> {
    for (entry in entries)
      if (sameOwner(entry.owner, owner) && entry.field == field)
        return entry;
    return null;
  }

  public function publicEntries(): Array<ModuleValueEntry> {
    return entries.copy();
  }

  static function parseAndValidate(owner: ClassType, field: Field,
      ownerFields: Array<Field>, metadata: Array<MetadataEntry>,
      bindings: Array<ModuleBindingFact>, module: Module): ModuleValueEntry {
    final first = metadata[0];
    if (metadata.length != 1 || first.params.length != 1) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-ARITY-001: @:genes.moduleValue on '
        + '${owner.name}.${field.name} must appear once with exactly one '
        + 'string-literal binding name',
        first.pos);
    }
    final parameter = first.params[0];
    final requestedName = switch parameter.expr {
      case EConst(CString(value)): value;
      default:
        return
          CompilerDiagnostic.fail('GENES-MODULE-VALUE-LITERAL-002: @:genes.moduleValue on '
          + '${owner.name}.${field.name} requires a direct string literal; '
          + 'computed binding names are not supported',
          parameter.pos);
    };
    if (requestedName.length == 0) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-EMPTY-003: @:genes.moduleValue on '
        + '${owner.name}.${field.name} requires a non-empty binding name',
        parameter.pos);
    }
    if (!IdentifierPolicy.isValidModuleBinding(requestedName)) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-IDENTIFIER-004: "${requestedName}" requested '
        + 'by ${owner.name}.${field.name} is not a valid non-reserved ASCII '
        + 'ES-module binding; use [A-Za-z_$][A-Za-z0-9_$]*',
        parameter.pos);
    }
    if (field.meta.has(DirectModuleBinding.FUNCTION_METADATA)) {
      return
        CompilerDiagnostic.fail('GENES-DIRECT-MODULE-BINDING-CONFLICT-001: '
        + '${owner.name}.${field.name} cannot be both '
        + '@:genes.moduleValue and @:genes.moduleFunction',
        first.pos);
    }
    if (!DirectModuleBinding.isModuleFieldsOwner(owner)) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-OWNER-006: "${requestedName}" requires '
        + 'a genuine Haxe module-level value; class static fields keep their '
        + 'class identity',
        owner.pos);
    }
    if (!field.isPublic || !field.isStatic || !field.kind.equals(Property)) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-SHAPE-007: "${requestedName}" requires '
        + 'a public static module-level value; ${owner.name}.${field.name} is '
        + fieldShape(field),
        field.pos);
    }
    if (field.expr == null) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-INITIALIZER-008: ${owner.name}.${field.name} '
        + 'has no retained initializer to emit as "${requestedName}"',
        field.pos);
    }
    if (!isFinal(owner, field)) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-MUTABLE-009: ${owner.name}.${field.name} '
        + 'is mutable; direct ESM values require a top-level `final` so Haxe '
        + 'and native consumers observe the same immutable binding',
        field.pos);
    }
    final nativeName = TypeUtil.nativeName(field.meta);
    if (nativeName != null && nativeName != requestedName) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-NATIVE-NAME-011: ${owner.name}.${field.name} '
        + 'has @:native("${nativeName}") but @:genes.moduleValue requests '
        + '"${requestedName}"; direct module values require one exact name',
        field.pos);
    }
    if (requestedName != field.name) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-PUBLIC-NAME-010: public module value '
        + '${owner.name}.${field.name} exports as "${field.name}", but '
        + '@:genes.moduleValue requests "${requestedName}"; use the exact '
        + 'Haxe field name',
        parameter.pos);
    }
    for (binding in bindings) {
      if (binding.name == requestedName) {
        return
          CompilerDiagnostic.fail('GENES-MODULE-VALUE-COLLISION-012: "${requestedName}" requested '
          + 'by ${owner.name}.${field.name} collides with an existing '
          + '${binding.kind}; choose another source field name',
          parameter.pos);
      }
    }
    final retained = Module.emittableFields(ownerFields);
    final ordinary = retained.filter(candidate -> candidate.meta == null
      || DirectModuleBinding.requestedNameFromMetadata(candidate.meta) == null);
    if (ordinary.length > 0) {
      final firstOrdinary = ordinary[0];
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-MIXED-OWNER-013: ${owner.name}.${field.name} '
        + 'cannot lower directly while the same Haxe module-fields owner keeps '
        + 'ordinary field "${firstOrdinary.name}"; mark every retained '
        + 'top-level function/value for direct lowering or move the ordinary '
        + 'field to another module',
        firstOrdinary.pos);
    }
    if (module.isCyclic(module.module)) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-CYCLE-014: ${owner.name}.${field.name} '
        + 'belongs to a cyclic module; v1 keeps cyclic static initialization '
        + 'on the existing deferred owner path',
        field.pos);
    }
    return new ModuleValueEntry(owner, field, requestedName, parameter.pos);
  }

  static function isFinal(owner: ClassType, field: Field): Bool {
    for (candidate in owner.statics.get()) {
      if (candidate.name != field.name)
        continue;
      return switch candidate.kind {
        case FVar(_, AccNever): true;
        default: false;
      }
    }
    return false;
  }

  static function fieldShape(field: Field): String {
    if (!field.isPublic)
      return 'non-public';
    if (!field.isStatic)
      return 'an instance member';
    return Std.string(field.kind);
  }

  static inline function sameOwner(left: ClassType, right: ClassType): Bool {
    return left.module == right.module && left.name == right.name;
  }
}
#end
