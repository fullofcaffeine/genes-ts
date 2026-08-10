package genes;

#if macro
import haxe.macro.Expr.MetadataEntry;
import haxe.macro.Expr.Position;
import haxe.macro.Type;
import genes.Module.Field;
import genes.ModuleFunctionPlan.ModuleBindingFact;
import genes.util.TypeUtil;

using Lambda;

/** One checked module-level value that becomes an ESM `const`. */
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

private typedef ClosedValueRejection = {
  final reason: String;
  final pos: Position;
}

/**
 * Checks the small data-only contract for direct ES-module values.
 *
 * A JavaScript `const` initializer runs while its module loads. Moving an
 * arbitrary Haxe initializer can therefore change behavior. This plan accepts
 * only primitive constants, nested array or object literals, parentheses, and
 * exact references to earlier selected values on the same compiler-created
 * owner. Calls, operators, constructors, imported values, and all other
 * computed expressions fail before either output writer opens.
 *
 * This rule is intentionally local and linear. It does not build a call graph
 * or try to infer side effects. Both output profiles consume the same checked
 * entries and only choose the target syntax.
 */
class ModuleValuePlan {
  public static final METADATA = ':genes.moduleValue';

  final entries: Array<ModuleValueEntry>;

  /** Reads one valid literal request without completing shape validation. */
  public static function requestedName(field: ClassField): Null<String> {
    return requestedNameFromMetadata(field.meta);
  }

  /** Metadata-only lookup used before the complete module plan exists. */
  public static function requestedNameFromMetadata(meta: MetaAccess): Null<String> {
    final requests = meta.extract(METADATA);
    return switch requests {
      case [{params: [{expr: EConst(CString(value))}]}]
        if (value.length > 0 && IdentifierPolicy.isValidModuleBinding(value)):
        value;
      default:
        null;
    }
  }

  public static function build(module: Module): ModuleValuePlan {
    final bindings = ModuleFunctionPlan.bindingInventory(module);
    for (entry in module.moduleFunctionRequestPlan.completeEntries())
      bindings.push({
        name: entry.requestedName,
        kind: 'direct module function ${entry.owner.name}.${entry.field.name}',
        pos: entry.requestedPos
      });

    final result: Array<ModuleValueEntry> = [];
    for (member in module.members) {
      switch member {
        case MClass(owner, _, fields):
          for (field in Module.emittableFields(fields)) {
            final metadata = field.meta == null ? [] : field.meta.extract(METADATA);
            if (metadata.length == 0)
              continue;
            final entry = parseAndValidate(owner, field, fields, metadata,
              bindings, result);
            result.push(entry);
            bindings.push({
              name: entry.requestedName,
              kind: 'direct module value ${entry.owner.name}.${entry.field.name}',
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

  /** Returns selected values in retained field order. */
  public function entriesFor(owner: ClassType): Array<ModuleValueEntry> {
    return entries.filter(entry -> sameOwner(entry.owner, owner));
  }

  /** Returns the selected entry for this exact normalized field. */
  public function entryFor(owner: ClassType,
      field: Field): Null<ModuleValueEntry> {
    for (entry in entries)
      if (sameOwner(entry.owner, owner) && entry.field == field)
        return entry;
    return null;
  }

  static function parseAndValidate(owner: ClassType, field: Field,
      ownerFields: Array<Field>, metadata: Array<MetadataEntry>,
      bindings: Array<ModuleBindingFact>,
      earlier: Array<ModuleValueEntry>): ModuleValueEntry {
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
          + '${owner.name}.${field.name} requires a direct string literal',
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
        + 'a genuine Haxe module-level value; a class static field keeps its '
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
        + 'is mutable; use a module-level `final` for a direct ESM const',
        field.pos);
    }
    final nativeName = TypeUtil.nativeName(field.meta);
    if (nativeName != null && nativeName != requestedName) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-NATIVE-NAME-011: ${owner.name}.${field.name} '
        + 'has @:native("${nativeName}") but @:genes.moduleValue requests '
        + '"${requestedName}"; use one exact name',
        field.pos);
    }
    if (requestedName != field.name) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-PUBLIC-NAME-010: public module value '
        + '${owner.name}.${field.name} exports as "${field.name}", but '
        + '@:genes.moduleValue requests "${requestedName}"',
        parameter.pos);
    }
    for (binding in bindings) {
      if (binding.name == requestedName) {
        return
          CompilerDiagnostic.fail('GENES-MODULE-VALUE-COLLISION-012: "${requestedName}" requested '
          + 'by ${owner.name}.${field.name} collides with an existing '
          + '${binding.kind}',
          parameter.pos);
      }
    }
    final retained = Module.emittableFields(ownerFields);
    final ordinary = retained.filter(candidate -> candidate.meta == null
      || (!candidate.meta.has(DirectModuleBinding.FUNCTION_METADATA)
        && !candidate.meta.has(DirectModuleBinding.VALUE_METADATA)));
    if (ordinary.length > 0) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-MIXED-OWNER-013: ${owner.name}.${field.name} '
        + 'cannot become a direct const while the same module keeps ordinary '
        + 'field "${ordinary[0].name}"',
        ordinary[0].pos);
    }
    if (owner.init != null) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-MIXED-OWNER-013: ${owner.name}.${field.name} '
        + 'cannot become a direct const while the same module has an '
        + 'initialization block',
        owner.init.pos);
    }
    final rejection = closedValueRejection(field.expr, owner, earlier);
    if (rejection != null) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-CLOSED-001: ${owner.name}.${field.name} '
        + 'must use closed data only. It ${rejection.reason}. Use primitive '
        + 'constants, nested array or object literals, or an earlier selected '
        + 'value from this module.',
        rejection.pos);
    }
    return new ModuleValueEntry(owner, field, requestedName, parameter.pos);
  }

  static function closedValueRejection(expression: TypedExpr,
      owner: ClassType,
      earlier: Array<ModuleValueEntry>): Null<ClosedValueRejection> {
    return switch expression.expr {
      case TConst(TInt(_) | TFloat(_) | TString(_) | TBool(_) | TNull):
        null;
      case TParenthesis(inner):
        closedValueRejection(inner, owner, earlier);
      case TArrayDecl(values):
        firstRejection(values, owner, earlier);
      case TObjectDecl(fields):
        firstRejection([for (field in fields) field.expr], owner, earlier);
      case TField(_, FStatic(ownerRef, fieldRef)):
        final referencedOwner = ownerRef.get();
        final referencedField = fieldRef.get();
        final allowed = sameOwner(owner, referencedOwner)
          && earlier.exists(entry -> entry.field.name == referencedField.name);
        allowed ? null : {
          reason: 'reads a value that is not an earlier selected value in the same module',
          pos: expression.pos
        };
      case TCall(_, _):
        {
          reason: 'calls a function while the module loads',
          pos: expression.pos
        };
      case TNew(_, _, _):
        {
          reason: 'constructs a runtime value while the module loads',
          pos: expression.pos
        };
      case TBinop(_, _, _) | TUnop(_, _, _):
        {reason: 'uses an operator to compute the value', pos: expression.pos};
      case TCast(inner, null):
        // Haxe adds this erased wrapper when it checks an object literal
        // against an explicit structural type. The inner expression must still
        // satisfy the complete closed-data grammar.
        closedValueRejection(inner, owner, earlier);
      case TCast(_, _):
        {reason: 'uses an explicit runtime type cast', pos: expression.pos};
      case TLocal(_):
        {reason: 'reads a local value', pos: expression.pos};
      case TFunction(_):
        {reason: 'contains a function value', pos: expression.pos};
      case TMeta(_, _):
        {reason: 'uses expression metadata', pos: expression.pos};
      case TField(_, _):
        {
          reason: 'reads a property or unsupported runtime value',
          pos: expression.pos
        };
      default:
        {
          reason: 'contains a computed expression outside the supported data subset',
          pos: expression.pos
        };
    };
  }

  static function firstRejection(expressions: Array<TypedExpr>,
      owner: ClassType,
      earlier: Array<ModuleValueEntry>): Null<ClosedValueRejection> {
    for (expression in expressions) {
      final rejection = closedValueRejection(expression, owner, earlier);
      if (rejection != null)
        return rejection;
    }
    return null;
  }

  static function isFinal(owner: ClassType, field: Field): Bool {
    for (candidate in owner.statics.get()) {
      if (candidate.name != field.name)
        continue;
      return switch candidate.kind {
        case FVar(_, AccNever): true;
        default: false;
      };
    }
    return false;
  }

  static function fieldShape(field: Field): String {
    if (!field.isPublic)
      return 'not public';
    if (!field.isStatic)
      return 'an instance member';
    return Std.string(field.kind);
  }

  static inline function sameOwner(left: ClassType, right: ClassType): Bool {
    return left.module == right.module && left.name == right.name;
  }
}
#end
