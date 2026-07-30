package genes;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr.Position;
import haxe.macro.Expr.MetadataEntry;
import haxe.macro.Type;
import genes.Module.Field;
import genes.NamePlan.NamePlanProfile;
import genes.util.TypeUtil;

using haxe.macro.TypedExprTools;

/** One validated static method whose body moves to a real module function. */
class ModuleFunctionEntry {
  public final owner: ClassType;
  public final field: Field;
  public final requestedName: String;
  public final requestedPos: Position;
  public final classPropertyName: String;
  public final publicExportName: Null<String>;

  public function new(owner: ClassType, field: Field, requestedName: String,
      requestedPos: Position, classPropertyName: String,
      publicExportName: Null<String>) {
    this.owner = owner;
    this.field = field;
    this.requestedName = requestedName;
    this.requestedPos = requestedPos;
    this.classPropertyName = classPropertyName;
    this.publicExportName = publicExportName;
  }
}

typedef ModuleBindingFact = {
  final name: String;
  final kind: String;
  final pos: Position;
}

private typedef LexicalRejection = {
  final reason: String;
  final pos: Position;
}

/**
 * Validates opt-in static methods before either output profile prints source.
 *
 * Why: some ecosystem analyzers assign meaning to a genuine module function
 * body and cannot inspect the same body inside an ES class. Moving that body is
 * safe only when the existing `Owner.field` remains the exact function value,
 * both output profiles choose the same explicit binding, and no hidden lexical
 * class privilege changes meaning.
 *
 * What: `@:genes.moduleFunction("name")` requests one ES-module function.
 * It remains private unless the same method also has `@:expose("name")`, in
 * which case the genuine function is exported under that exact binding and
 * re-exported from the compilation root. The emitters retain a compiler-owned
 * method descriptor in the original class slot, then immediately replace only
 * its value. This plan owns metadata parsing, the intentionally narrow v1
 * eligibility contract, exact name collisions, and source positions; printers
 * only render validated facts.
 *
 * How: dependency aliases and local names are finalized first, then one shared
 * inventory is compared with each requested binding in source order. Metadata
 * is not a DCE root: only post-DCE, emittable fields enter the plan. Raw target
 * syntax is rejected because it can conceal `this`, `super`, or `new.target`.
 * Ordinary private static calls and Haxe local statics remain valid: Genes does
 * not emit JavaScript `#private` syntax, and Haxe 4.3.7 lowers a local static to
 * an ordinary synthetic owner field before this plan runs.
 *
 * The opt-in deliberately changes intrinsic function-object facts that no
 * genuine module function can preserve: the final function is constructable,
 * owns `prototype`, reports the requested `name`, and has module-function
 * `toString()` syntax. Calls, extraction, reassignment, recursion through the
 * typed `Owner.field`, property descriptor/order, registration, and supported
 * reflection remain the compatibility contract.
 */
class ModuleFunctionPlan {
  static final METADATA = ':genes.moduleFunction';
  static final EXPOSE_METADATA = ':expose';

  final entries: Array<ModuleFunctionEntry>;

  /** True only for Haxe's synthetic owner of genuine module-level fields. */
  public static function isModuleFieldsOwner(owner: ClassType): Bool {
    return #if (haxe_ver >= 4.2)
      owner.kind.match(KModuleFields(_));
    #else
      false;
    #end
  }

  /**
   * Returns one syntactically valid direct binding before plans are complete.
   *
   * Expression emission historically asks this function-oriented plan about
   * Haxe's synthetic module fields. Include the sibling module-value marker so
   * both shapes use the same direct binding without coupling the shared
   * expression printer to either validation plan.
   */
  public static function requestedName(field: ClassField): Null<String> {
    final functionName = requestedNameFromMetadata(field.meta);
    return
      functionName != null ? functionName : ModuleValuePlan.requestedNameFromMetadata(field.meta);
  }

  /** Metadata-only form shared by normalized module-field planning. */
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

  public static function build(module: Module): ModuleFunctionPlan {
    final bindings = bindingInventory(module);
    for (member in module.members) {
      switch member {
        case MClass(owner, _, fields):
          for (field in Module.emittableFields(fields)) {
            if (field.meta == null)
              continue;
            final requested = ModuleValuePlan.requestedNameFromMetadata(field.meta);
            if (requested != null)
              bindings.push({
                name: requested,
                kind: 'direct module value ${owner.name}.${field.name}',
                pos: field.pos
              });
          }
        case MEnum(_, _) | MType(_, _) | MMain(_):
      }
    }
    final entries: Array<ModuleFunctionEntry> = [];
    for (member in module.members) {
      switch member {
        case MClass(owner, _, fields):
          for (field in Module.emittableFields(fields)) {
            final metadata = field.meta == null ? [] : field.meta.extract(METADATA);
            final exposeMetadata = field.meta == null ? [] : field.meta.extract(EXPOSE_METADATA);
            if (metadata.length == 0)
              continue;
            final entry = parseAndValidate(owner, field, metadata, bindings,
              fields, exposeMetadata);
            entries.push(entry);
            bindings.push({
              name: entry.requestedName,
              kind: 'module function ${owner.name}.${field.name}',
              pos: entry.requestedPos
            });
          }
        case MEnum(_, _) | MType(_, _) | MMain(_):
      }
    }
    return new ModuleFunctionPlan(entries);
  }

  public function new(entries: Array<ModuleFunctionEntry>) {
    this.entries = entries.copy();
  }

  /** Returns selected functions owned by `owner`, in retained field order. */
  public function entriesFor(owner: ClassType): Array<ModuleFunctionEntry> {
    return entries.filter(entry -> sameOwner(entry.owner, owner));
  }

  /** Returns the selected entry for this exact owner/field identity. */
  public function entryFor(owner: ClassType,
      field: Field): Null<ModuleFunctionEntry> {
    for (entry in entries)
      if (sameOwner(entry.owner, owner) && entry.field == field)
        return entry;
    return null;
  }

  public function isEmpty(): Bool {
    return entries.length == 0;
  }

  /**
   * Whether a compiler-synthetic module-fields class has no runtime purpose
   * after all selected functions and values become direct ESM declarations.
   */
  public function canOmitSyntheticOwner(owner: ClassType,
      fields: Array<Field>): Bool {
    return DirectModuleBinding.canOmitSyntheticOwner(owner, fields);
  }

  /** Returns every public module-function binding in deterministic plan order. */
  public function publicEntries(): Array<ModuleFunctionEntry> {
    return entries.filter(entry -> entry.publicExportName != null);
  }

  /**
   * Public functions that also belong in the compilation-root barrel.
   *
   * Genuine Haxe module fields already export from their own ESM module and
   * therefore remain module-local; different modules may own the same binding.
   */
  public function rootPublicEntries(): Array<ModuleFunctionEntry> {
    return publicEntries().filter(entry -> !isModuleFieldsOwner(entry.owner));
  }

  static function parseAndValidate(owner: ClassType, field: Field,
      metadata: Array<MetadataEntry>, bindings: Array<ModuleBindingFact>,
      ownerFields: Array<Field>,
      exposeMetadata: Array<MetadataEntry>): ModuleFunctionEntry {
    final first = metadata[0];
    if (metadata.length != 1 || first.params.length != 1) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-ARITY-001: @:genes.moduleFunction on '
        + '${owner.name}.${field.name} must appear once with exactly one '
        + 'string-literal binding name',
        first.pos);
    }
    final parameter = first.params[0];
    final requestedName = switch parameter.expr {
      case EConst(CString(value)): value;
      default:
        return
          CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-LITERAL-002: @:genes.moduleFunction on '
          + '${owner.name}.${field.name} requires a direct string literal; '
          + 'computed binding names are not supported',
          parameter.pos);
    };
    if (requestedName.length == 0) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-EMPTY-003: @:genes.moduleFunction on '
        + '${owner.name}.${field.name} requires a non-empty binding name',
        parameter.pos);
    }
    if (!IdentifierPolicy.isValidModuleBinding(requestedName)) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-IDENTIFIER-004: "${requestedName}" requested '
        + 'by ${owner.name}.${field.name} is not a valid non-reserved ASCII '
        + 'ES-module binding; use [A-Za-z_$][A-Za-z0-9_$]*',
        parameter.pos);
    }
    if (field.meta.has(ModuleValuePlan.METADATA)) {
      return
        CompilerDiagnostic.fail('GENES-DIRECT-MODULE-BINDING-CONFLICT-001: '
        + '${owner.name}.${field.name} cannot be both '
        + '@:genes.moduleFunction and @:genes.moduleValue',
        first.pos);
    }
    final publicExportName = parsePublicExport(owner, field, exposeMetadata);
    if (publicExportName != null && publicExportName != requestedName) {
      CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-EXPOSE-NAME-016: @:expose on '
        + '${owner.name}.${field.name} requests "${publicExportName}", but '
        + '@:genes.moduleFunction requests "${requestedName}"; v1 requires '
        + 'one exact name for the local and public ESM binding',
        exposeMetadata[0].pos);
    }

    validateShape(owner, field, requestedName);
    for (binding in bindings) {
      if (binding.name != requestedName)
        continue;
      return
        CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-COLLISION-005: "${requestedName}" requested '
        + 'by ${owner.name}.${field.name} collides with an existing '
        + '${binding.kind}; choose another exact module binding',
        parameter.pos);
    }

    final classPropertyName = EmittedMemberName.staticField(owner, field);
    if (!IdentifierPolicy.isAsciiIdentifier(classPropertyName)
      || classPropertyName == 'prototype') {
      return
        CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-SHAPE-006: ${owner.name}.${field.name} emits '
        + 'the unsupported class property "${classPropertyName}"; v1 requires '
        + 'a non-prototype ASCII member name',
        field.pos);
    }
    for (other in Module.emittableFields(ownerFields)) {
      if (other == field || !other.isStatic)
        continue;
      final otherPropertyName = EmittedMemberName.staticField(owner, other);
      if (otherPropertyName != classPropertyName)
        continue;
      return
        CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-SHAPE-006: ${owner.name}.${field.name} and '
        + '${owner.name}.${other.name} both emit the static class property '
        + '"${classPropertyName}"; give them distinct @:native names before '
        + 'moving either body to "${requestedName}"',
        field.pos);
    }

    final rejection = lexicalRejection(field.expr, field.meta != null && field.meta.has(':jsAsync'));
    if (rejection != null) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-LEXICAL-010: ${owner.name}.${field.name} '
        + 'cannot move to module scope because ${rejection.reason}; keep it '
        + 'as a class method or remove the class-lexical dependency',
        rejection.pos);
    }

    return new ModuleFunctionEntry(owner, field, requestedName, parameter.pos,
      classPropertyName, publicExportName);
  }

  static function parsePublicExport(owner: ClassType, field: Field,
      metadata: Array<MetadataEntry>): Null<String> {
    if (metadata.length == 0) {
      #if (haxe_ver >= 4.2)
      // Haxe module-level functions are public ESM fields by construction.
      // Their synthetic KModuleFields class is compiler machinery, so the
      // genuine module function replaces the ordinary `export const` alias.
      if (owner.kind.match(KModuleFields(_)) && field.isPublic)
        return field.name;
      #end
      return null;
    }
    final first = metadata[0];
    if (metadata.length != 1 || first.params.length > 1) {
      CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-EXPOSE-ARITY-011: @:expose on '
        + '${owner.name}.${field.name} must appear once with zero arguments '
        + 'or one direct string-literal ESM name',
        first.pos);
    }
    final name = if (first.params.length == 0) field.name else
      switch first.params[0].expr {
      case EConst(CString(value)): value;
      default:
        return
            CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-EXPOSE-LITERAL-012: @:expose on '
          + '${owner.name}.${field.name} requires a direct string literal; '
          + 'computed public names are not supported',
          first.params[0].pos);
    };
    if (name.length == 0) {
      CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-EXPOSE-EMPTY-013: @:expose on '
        + '${owner.name}.${field.name} requires a non-empty ESM name',
        first.pos);
    }
    if (!IdentifierPolicy.isValidModuleBinding(name)) {
      CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-EXPOSE-IDENTIFIER-014: "${name}" requested '
        + 'by @:expose on ${owner.name}.${field.name} is not a valid '
        + 'non-reserved ASCII ESM binding',
        first.pos);
    }
    return name;
  }

  static function validateShape(owner: ClassType, field: Field,
      requestedName: String): Void {
    final supportedOwner = owner.kind.match(KNormal) #if (haxe_ver >= 4.2)
      || owner.kind.match(KModuleFields(_)) #end;
    if (owner.isExtern || owner.isInterface || !supportedOwner) {
      CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-OWNER-007: "${requestedName}" requires a '
        + 'concrete, non-extern class or module-field owner; ${owner.name} is '
        + Std.string(owner.kind),
        owner.pos);
    }
    if (owner.params.length != 0) {
      CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-OWNER-007: "${requestedName}" cannot lower '
        + '${owner.name}.${field.name} because generic class owners are not '
        + 'supported in v1; move the type parameter to the method or keep the '
        + 'class-method shape',
        owner.pos);
    }
    if (!field.isPublic
      || !field.isStatic
      || !field.kind.equals(Method)
      || field.methodKind != MethNormal) {
      CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-SHAPE-006: "${requestedName}" requires a '
        + 'public static normal method; ${owner.name}.${field.name} is '
        + fieldShape(field),
        field.pos);
    }
    #if (haxe_ver >= 4.2)
    if (field.isAbstract) {
      CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-BODY-008: ${owner.name}.${field.name} has no '
        + 'concrete body to move to "${requestedName}"',
        field.pos);
    }
    #end
    if (field.overloads.length != 0) {
      CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-OVERLOAD-009: ${owner.name}.${field.name} has '
        + 'Haxe overloads, which module-function lowering does not yet '
        + 'support; remove the metadata or expose one non-overloaded adapter',
        field.pos);
    }
    switch field.expr {
      case {expr: TFunction(_)}:
      case null:
        CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-BODY-008: ${owner.name}.${field.name} has no '
          + 'retained function body to move to "${requestedName}"',
          field.pos);
      default:
        CompilerDiagnostic.fail('GENES-MODULE-FUNCTION-BODY-008: ${owner.name}.${field.name} did not '
          + 'type as one function body; keep the ordinary class shape',
          field.pos);
    }
  }

  static function lexicalRejection(expression: TypedExpr,
      nativeAsyncOwner: Bool): Null<LexicalRejection> {
    if (expression == null)
      return null;
    var rejection: Null<LexicalRejection> = null;
    function visit(current: TypedExpr): Void {
      if (rejection != null)
        return;
      switch current.expr {
        case TConst(TThis):
          rejection = {reason: 'its body contains `this`', pos: current.pos};
        case TConst(TSuper):
          rejection = {reason: 'its body contains `super`', pos: current.pos};
        case TCall({expr: TField(_, FStatic(ownerRef, fieldRef))}, arguments)
          if (ownerRef.get().module == 'js.Syntax'):
          if (!isProvenLexicallyNeutralSyntax(fieldRef.get().name, arguments,
            nativeAsyncOwner))
            rejection = {
              reason: 'its body contains opaque js.Syntax target code',
              pos: current.pos
            };
        case TCall({expr: TIdent('__js__')}, _):
          rejection = {
            reason: 'its body contains opaque legacy __js__ target code',
            pos: current.pos
          };
        default:
      }
      if (rejection == null)
        current.iter(visit);
    }
    visit(expression);
    return rejection;
  }

  /**
   * Admits only exact compiler-library expressions whose lexical behavior is
   * fully known.
   *
   * Why: typed helpers such as `Undefinable.orNull()` inline one js.Syntax
   * call into otherwise ordinary application code. Moving `{0} ?? null` from
   * a class method to a module function cannot change `this`, `super`,
   * `arguments`, `new.target`, or private-name resolution because the fixed
   * template contains none of them. Genes' typed async authoring similarly
   * lowers `await(value)` to the fixed `await {0}` template, but only a field
   * already carrying the typed `:jsAsync` fact may relocate that expression.
   * Haxe's typed `Array.map` uses the separate fixed `construct` intrinsic with
   * a resolved type expression. `genes.js.ArrayCallbacks.findIndex` similarly
   * owns the fixed `{0}.findIndex({1})` projection. Every admitted template
   * argument stays inside the ordinary recursive validation.
   *
   * How: this is an exact allowlist with exact arity, not a string heuristic.
   * Every user-defined or newly introduced template remains opaque and fails
   * closed until its relocation semantics receive an explicit regression.
   */
  static function isProvenLexicallyNeutralSyntax(method: String,
      arguments: Array<TypedExpr>, nativeAsyncOwner: Bool): Bool {
    return switch method {
      case 'code':
        if (arguments.length == 0) false; else {
          final template = switch arguments[0].expr {
            case TConst(TString(value)): value;
            default: null;
          };
          switch [template, arguments.length] {
            case ['undefined', 1] | ['{0}', 2] | ['({0})', 2] |
              ['{0} ?? null', 2] | ['({0}) === undefined', 2] |
              ['{0}.findIndex({1})', 3]:
              true;
            case ['await {0}', 2]:
              nativeAsyncOwner;
            default:
              false;
          }
        }
      case 'construct': // Haxe's typed JavaScript Array.map implementation lowers its result
        // allocation through `js.Syntax.construct(Array, length)`. A resolved
        // TTypeExpr names the same emitted constructor from class or module
        // scope; every constructor argument is still visited separately by the
        // lexical validator. String-named constructors remain opaque.
        arguments.length > 0 && switch arguments[0].expr {
          case TTypeExpr(_): true;
          default: false;
        };
      default:
        false;
    };
  }

  public static function bindingInventory(module: Module): Array<ModuleBindingFact> {
    final result: Array<ModuleBindingFact> = [];
    function add(name: String, kind: String, pos: Position): Void {
      for (existing in result)
        if (existing.name == name)
          return;
      result.push({name: name, kind: kind, pos: pos});
    }

    for (member in module.members) {
      switch member {
        case MClass(owner, _, fields):
          add(TypeUtil.className(owner), 'module type ${owner.name}',
            owner.pos);
          #if (haxe_ver >= 4.2)
          if (owner.kind.match(KModuleFields(_))) {
            for (field in Module.emittableFields(fields))
              if (field.isStatic
                && field.isPublic
                && (field.meta == null
                  || (!field.meta.has(METADATA)
                    && !field.meta.has(ModuleValuePlan.METADATA))))
                add(field.name, 'public module field ${field.name}', field.pos);
          }
          #end
          if (Context.defined('genes.ts.lower_private_helpers')) {
            for (field in Module.emittableFields(fields))
              if (isPrivateHelper(field))
                add(privateHelperName(owner, field.name),
                  'lowered private helper ${owner.name}.${field.name}',
                  field.pos);
          }
        case MEnum(enumType, _):
          add(enumType.name, 'enum ${enumType.name}', enumType.pos);
        // A Haxe enum reserves its own top-level name, but its constructors
        // are properties of that value. For example, `Ready` on `State` is
        // emitted as `State.Ready`; it does not create a standalone `Ready`
        // variable that can collide with a requested module function.
        case MType(definition, _):
          add(definition.name, 'type ${definition.name}', definition.pos);
        case MMain(_):
      }
    }

    for (name in module.runtimeProjection.bindings.localBindingNames())
      add(name, 'runtime import binding ${name}', Context.currentPos());
    for (name in module.implementationProjection.bindings.localBindingNames())
      add(name, 'TypeScript import binding ${name}', Context.currentPos());
    for (name in module.namePlan(ClassicStable).moduleBindingNames())
      add(name, 'classic module local ${name}', Context.currentPos());
    for (name in module.namePlan(TypeScriptReadable).moduleBindingNames())
      add(name, 'TypeScript module local ${name}', Context.currentPos());
    for (name in module.namePlan(TypeScriptReadable, true).moduleBindingNames())
      add(name, 'TSX module local ${name}', Context.currentPos());
    for (name in module.tempPlan.moduleBindingNames())
      add(name, 'compiler module temporary ${name}', Context.currentPos());

    // In a Haxe interpolated string, `$$` emits one literal `$`.
    add('$$global', 'compiler-owned global alias', Context.currentPos());
    if (JsonTypeSupport.moduleUsesJsonTypes(module)
      || JsonTypeSupport.dependenciesUseJsonTypes(module.implementationProjection.bindings)) {
      for (name in ['JsonPrimitive', 'JsonObject', 'JsonArray', 'JsonValue', 'JsonNonNullValue'])
        add(name, 'generated JSON type alias ${name}', Context.currentPos());
    }
    return result;
  }

  static function isPrivateHelper(field: Field): Bool {
    return field.isStatic
      && !field.isPublic
      && field.kind.equals(Method)
      && field.meta != null
      && (field.meta.has(':genesLowerPrivateHelper')
        || field.meta.has('genesLowerPrivateHelper')
        || field.meta.has(':genes.lowerPrivateHelper')
        || field.meta.has('genes.lowerPrivateHelper'));
  }

  public static function privateHelperName(owner: ClassType,
      fieldName: String): String {
    return '__'
      + TypeUtil.className(owner).split('$').join('_')
      + '_'
      + fieldName.split('$').join('_');
  }

  static function fieldShape(field: Field): String {
    if (!field.isPublic)
      return 'non-public';
    if (!field.isStatic)
      return 'an instance member';
    if (!field.kind.equals(Method))
      return Std.string(field.kind);
    return Std.string(field.methodKind);
  }

  static inline function sameOwner(left: ClassType, right: ClassType): Bool {
    return left.module == right.module && left.name == right.name;
  }
}
#end
