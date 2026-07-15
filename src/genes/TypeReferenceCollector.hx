package genes;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Expr.Position;
import haxe.macro.Type;
import genes.dts.TypeEmitter;

using StringTools;
using haxe.macro.TypeTools;

private typedef IncludeType = (type:ModuleType, rule:String, pos:Position)->Void;

/**
 * Extracts importable declarations from a target type projection.
 *
 * Why: `Module.typeDependencies` historically discovered reachability by
 * running `TypeEmitter` against a writer that discarded all text. Besides
 * coupling DCE to printer order, that provided no typed edge or provenance for
 * validation. This collector expresses the same projection decisions as typed
 * traversal: built-in TS spellings do not create Haxe imports, raw type
 * overrides traverse only referenced `$N` parameters, and ordinary named types
 * retain their original `ModuleType`.
 *
 * What: callers receive only declarations that the TS/declaration projection
 * can name, plus a stable rule suffix and source position. Runtime expression
 * dependencies are intentionally handled by `DependencyPlanBuilder` because
 * they follow value semantics rather than type spelling.
 *
 * How: the switch mirrors the semantic branches of `TypeEmitter.emitType`, but
 * never writes target text or allocates aliases. A recursion stack protects
 * pathological abstract cycles. Focused dependency-plan fixtures and existing
 * generated-output snapshots guard parity whenever a new type projection is
 * added to the printer.
 */
class TypeReferenceCollector {
  final includeType: IncludeType;
  final stack = new Map<String, Bool>();

  public function new(includeType: IncludeType) {
    this.includeType = includeType;
  }

  /** Collects applied parameters and, when requested, generic constraints. */
  public function collectParams(params: Array<Type>, withConstraints: Bool,
      rule: String, pos: Position): Void {
    for (param in params) {
      collect(param, '$rule.parameter', pos);
      if (withConstraints)
        switch param {
          case TInst(_.get() => {kind: KTypeParameter(constraints)}, _):
            for (constraint in constraints)
              collect(constraint, '$rule.constraint', pos);
          default:
        }
    }
  }

  /** Collects every named declaration required to render one Haxe type. */
  public function collect(type: Type, rule: String, pos: Position): Void {
    if (type == null)
      return;
    final stackKey = type.toString();
    if (stack.exists(stackKey))
      return;
    stack.set(stackKey, true);
    collectInner(type, rule, pos);
    stack.remove(stackKey);
  }

  function collectInner(type: Type, rule: String, pos: Position): Void {
    switch type {
      case TInst(_.get() => {name: "RegroupStatus" | "RegroupResult"}, _) |
        TType(_.get() => {name: "RegroupStatus" | "RegroupResult"}, _):
        // These legacy helpers deliberately project to `any`.

      case TInst(_.get().meta => meta, params)
        if (hasTypeOverride(meta)):
        collectOverride(meta, params, '$rule.type-override', pos);

      case TInst(ref = _.get() => cl, params):
        switch [cl, params] {
          case [{module: "js.node.Fs", name: "FsPath"}, _] |
            [{name: "RegroupStatus" | "RegroupResult"}, _] |
            [{module: "js.lib.Promise", name: "Promise"}, []] |
            [{name: "RegExpMatch"}, _] |
            [{pack: [], name: "String"}, _] |
            [{module: "js.lib.Symbol", name: "Symbol"}, _]:
            // Projected to a target/global type with no Haxe import.
          case [{name: name}, _] if (name.indexOf('<') > -1):
          case [{kind: KTypeParameter(_)}, _]:
          case [{module: moduleName}, _]
            if (moduleName != null && moduleName.startsWith('haxe.macro')):
          case [{meta: meta}, _] if (isGlobalBuffer(meta)):
          case [{meta: meta}, _] if (isNativeRegExp(meta)):
          case [{module: "js.lib.Set", name: "Set"}, [element]] |
            [{module: "js.lib.Promise", name: "Promise"}, [element]] |
            [{module: "js.lib.Iterator", name: "Iterator"}, [element]] |
            [{module: "js.lib.Iterator", name: "AsyncIterator"}, [element]] |
            [{pack: [], name: "Array"}, [element]]:
            collect(element, '$rule.element', cl.pos);
          case [{module: "js.lib.Map", name: "Map"}, [key, value]]:
            collect(key, '$rule.key', cl.pos);
            collect(value, '$rule.value', cl.pos);
          default:
            includeType(TClassDecl(ref), '$rule.named-class', cl.pos);
            collectParams(params, false, '$rule.class-arguments', cl.pos);
        }

      case TAbstract(_.get().meta => meta, params)
        if (hasTypeOverride(meta)):
        collectOverride(meta, params, '$rule.type-override', pos);

      case TAbstract(_.get() => abstractType, params):
        if (Context.defined('genes.ts')
          && TypeEmitter.enumAbstractLiteralUnion(abstractType) != null)
          return;
        switch [abstractType, params] {
          case [{module: "js.lib.Symbol", name: "Symbol"}, _] |
            [{name: "RegroupStatus" | "RegroupResult"}, _] |
            [{pack: [], name: "Int" | "Float" | "Bool" | "Void"}, _]:
          case [{pack: [], name: "Null"}, [underlying]] |
            [{pack: ["haxe", "extern"] | ["haxe"], name: "Rest"}, [underlying]]:
            collect(underlying, '$rule.abstract-value', abstractType.pos);
          case [{pack: ["haxe", "extern"], name: "EitherType"}, [left, right]]:
            collect(left, '$rule.union-left', abstractType.pos);
            collect(right, '$rule.union-right', abstractType.pos);
          default:
            if (!abstractType.meta.has(':coreType'))
              collect(abstractType.type.applyTypeParameters(
                abstractType.params, params), '$rule.abstract-underlying',
                abstractType.pos);
        }

      case TAnonymous(_.get() => anonymous):
        var hasRuntimeFields = false;
        for (field in anonymous.fields)
          if (field.name.startsWith('__') || field.name.startsWith('_hx_')) {
            hasRuntimeFields = true;
            break;
          }
        if (hasRuntimeFields)
          return;
        for (field in anonymous.fields) {
          final fieldRule = '$rule.anonymous-field';
          collectParams([for (parameter in field.params) parameter.t], false,
            '$fieldRule.parameters', field.pos);
          if (hasTypeOverride(field.meta)) {
            collectOverride(field.meta,
              [for (parameter in field.params) parameter.t],
              '$fieldRule.type-override', field.pos);
            continue;
          }
          final cachedFieldType = Context.defined('genes.ts')
            ? genes.ts.SignatureCache.getAnonFieldTsType(field.pos)
            : null;
          if (cachedFieldType == null)
            collect(NullishContract.forField(field).emittedType,
              '$fieldRule.value', field.pos);
        }

      case TType(ref = _.get() => definition, params):
        switch [definition, params] {
          case [{pack: ["haxe", "extern"] | ["haxe"], name: "Rest"},
            [element]] |
            [{module: "js.lib.Iterator", name: "Iterator"}, [element]] |
            [{module: "js.lib.Iterator", name: "AsyncIterator"}, [element]] |
            [{module: "js.lib.Iterator", name: "IteratorStep"}, [element]] |
            [{pack: [], name: "Null"}, [element]]:
            collect(element, '$rule.typedef-value', definition.pos);
          case [{module: "js.node.Fs", name: "FsPath"}, _] |
            [{name: "RegExpMatch" | "RegroupStatus" | "RegroupResult"}, _]:
          case [{name: name}, _] if (name.indexOf('<') > -1):
          case [{module: moduleName}, _]
            if (moduleName != null && moduleName.startsWith('haxe.macro')):
          default:
            switch definition.type {
              case TInst(_.get() => {isExtern: true}, _):
                collect(definition.type.applyTypeParameters(
                  definition.params, params), '$rule.extern-typedef',
                  definition.pos);
              case TAbstract(abstractRef = _.get() => {
                pack: ["haxe", "extern"],
                name: "EitherType"
              }, arguments) if (arguments.length == params.length):
                collect(TAbstract(abstractRef, params),
                  '$rule.either-typedef', definition.pos);
              default:
                includeType(TTypeDecl(ref), '$rule.named-typedef',
                  definition.pos);
                collectParams(params, false, '$rule.typedef-arguments',
                  definition.pos);
            }
        }

      case TFun(arguments, result):
        var noOptionalUntil = -1;
        var hadOptional = true;
        for (index in 0...arguments.length) {
          final argument = arguments[index];
          if (argument.opt)
            hadOptional = true;
          else if (hadOptional) {
            noOptionalUntil = index;
            hadOptional = false;
          }
        }
        for (index in 0...arguments.length) {
          final argument = arguments[index];
          final nullish = NullishContract.forParameter(argument.t,
            argument.opt && index > noOptionalUntil);
          collect(nullish.emittedType, '$rule.function-argument', pos);
        }
        collect(result, '$rule.function-result', pos);

      case TDynamic(element) if (element != null):
        collect(element, '$rule.dynamic-value', pos);

      case TEnum(ref = _.get() => enumType, params):
        if (enumType.module == null
          || !enumType.module.startsWith('haxe.macro')) {
          includeType(TEnumDecl(ref), '$rule.named-enum', enumType.pos);
          collectParams(params, false, '$rule.enum-arguments', enumType.pos);
        }

      default:
        // Monomorphs, lazies, untyped Dynamic, and unsupported target types
        // currently project to `any` and therefore carry no named dependency.
    }
  }

  static function hasTypeOverride(meta: MetaAccess): Bool {
    return meta.has(':ts.type') || meta.has(':genes.type');
  }

  static function typeOverride(meta: MetaAccess): Null<String> {
    final ts = switch meta.extract(':ts.type') {
      case [{params: [{expr: EConst(CString(value))}]}]: value;
      default: null;
    };
    if (ts != null)
      return ts;
    return switch meta.extract(':genes.type') {
      case [{params: [{expr: EConst(CString(value))}]}]: value;
      default: null;
    };
  }

  /** Traverses only `$0`, `$1`, ... arguments interpolated by a raw override. */
  function collectOverride(meta: MetaAccess, params: Array<Type>, rule: String,
      pos: Position): Void {
    final template = typeOverride(meta);
    if (template == null) {
      Context.error('@:ts.type/@:genes.type needs a string expression', pos);
      return;
    }
    var index = 0;
    while (index < template.length) {
      final marker = template.indexOf('$', index);
      if (marker == -1)
        return;
      if (marker + 1 < template.length
        && template.charAt(marker + 1) == '$') {
        index = marker + 2;
        continue;
      }
      var end = marker + 1;
      while (end < template.length) {
        final character = template.charCodeAt(end);
        if (character < '0'.code || character > '9'.code)
          break;
        end++;
      }
      if (end == marker + 1) {
        index = marker + 1;
        continue;
      }
      final parameterIndex = Std.parseInt(template.substr(marker + 1,
        end - marker - 1));
      if (parameterIndex != null && parameterIndex >= 0
        && parameterIndex < params.length)
        collect(params[parameterIndex], '$rule.parameter-$parameterIndex', pos);
      index = end;
    }
  }

  static function isGlobalBuffer(meta: MetaAccess): Bool {
    return switch meta.extract(':jsRequire') {
      case [{
        params: [
          {expr: EConst(CString("buffer"))},
          {expr: EConst(CString("Buffer"))}
        ]
      }]: true;
      default: false;
    }
  }

  static function isNativeRegExp(meta: MetaAccess): Bool {
    return switch meta.extract(':native') {
      case [{params: [{expr: EConst(CString("RegExp"))}]}]: true;
      default: false;
    }
  }
}
#end
