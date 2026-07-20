package genes.react.internal;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Expr.ComplexType;
import haxe.macro.Expr.TypeParam;
import haxe.macro.Expr.TypePath;
import haxe.macro.Type;
import haxe.macro.TypeTools;

typedef JsxContextProp = {
  var index: Int;
  var name: String;
  var value: Expr;
}

private typedef JsxContextFunction = {
  var type: Type;
  var argumentsOnly: Bool;
}

/**
 * Gives inline HXX callbacks their expected Haxe argument types.
 *
 * Why: Haxe sees `event -> event.preventDefault()` before the later JSX
 * checker runs. Without an expected callback type, `event` is unresolved and
 * useful editor/compiler feedback is lost.
 *
 * What: the inline-markup macro asks this helper for the property contract,
 * including inherited interface fields, closed union arms, and generic
 * substitutions. Plain function properties receive an `ECheckType`. A
 * function inside a union receives only argument annotations, leaving its
 * result inferred for the later union-aware checker. Runtime expressions and
 * evaluation order are unchanged.
 *
 * How: safe property expressions may be typed once to bind a component's
 * generic parameters. Function bodies are then typed against the substituted
 * callback contract. Calls and other macro-sensitive expressions are never
 * probed merely to improve contextual typing; `JsxTypeChecker` still validates
 * every value and fails closed.
 */
class JsxContext {
  static final DEFAULT_INTRINSIC_PROVIDER = 'genes.react.IntrinsicElements';

  public static function contextualize(tagName: String, tag: Expr,
      intrinsic: Bool, props: Array<JsxContextProp>): Map<Int, Expr> {
    final propsType = intrinsic ? intrinsicPropsType(tagName) : componentPropsType(Context.typeExpr(tag)
      .t);
    if (propsType == null)
      return [];
    final fields = propertyFields(propsType);
    if (fields == null)
      return [];

    final bindings: Map<String, Type> = [];
    for (prop in props) {
      if (functionArity(prop.value) != null)
        continue;
      final expected = fields.get(prop.name);
      if (expected == null || !canProbe(prop.value))
        continue;
      bindTypeParameters(Context.typeExpr(prop.value).t, expected, bindings, 0);
    }

    final out: Map<Int, Expr> = [];
    for (prop in props) {
      if (!isContextualFunction(prop.value))
        continue;
      final expected = fields.get(prop.name);
      if (expected == null)
        continue;
      final contextual = unwrapNullable(substitute(expected, bindings, 0));
      if (containsTypeParameter(contextual, 0))
        continue;
      final arity = functionArity(prop.value);
      if (arity == null)
        continue;
      final callback = contextualFunction(contextual, arity, false, 0);
      if (callback == null)
        continue;
      if (callback.argumentsOnly) {
        final rewritten = annotateFunctionArguments(prop.value, callback.type);
        if (rewritten != null)
          out.set(prop.index, rewritten);
      } else {
        final complex = contextualComplexType(callback.type);
        if (complex != null)
          out.set(prop.index, {
            expr: ECheckType(prop.value, complex),
            pos: prop.value.pos
          });
      }
    }
    return out;
  }

  /**
   * Projects focused React event facades to Haxe's complete DOM externs.
   *
   * Haxe gives the library's intrinsic schema a stable, target-neutral facade,
   * but an inline callback should still see the complete browser API. Loading
   * the standard module first and then using the compiler-reported source or
   * native identity also avoids Haxe's order-sensitive lookup of `@:native`
   * main module types: both an already-used DOM type and a context-first HXX
   * callback resolve to the same class identity.
   */
  static function contextualComplexType(type: Type): Null<ComplexType> {
    final complex = TypeTools.toComplexType(type);
    return complex == null ? null : projectBrowserFacades(complex);
  }

  static function projectBrowserFacades(type: ComplexType): ComplexType {
    return switch type {
      case TPath(path):
        final projected = projectTypePath(path);
        TPath(projected);
      case TFunction(arguments, result):
        TFunction([
          for (argument in arguments)
            projectBrowserFacades(argument)
        ], projectBrowserFacades(result));
      case TParent(inner):
        TParent(projectBrowserFacades(inner));
      case TOptional(inner):
        TOptional(projectBrowserFacades(inner));
      case TNamed(name, inner):
        TNamed(name, projectBrowserFacades(inner));
      case TIntersection(types):
        TIntersection([
          for (member in types)
            projectBrowserFacades(member)
        ]);
      case TAnonymous(_) | TExtend(_, _):
        // This projection is applied only to a function property's contextual
        // type. Anonymous structures cannot contain the function's argument
        // path without first appearing in one of the recursive forms above.
        type;
    };
  }

  static function projectTypePath(path: TypePath): TypePath {
    final qualified = path.pack.concat([path.name]).join('.');
    if (path.sub == null && qualified == 'genes.react.AnchorElement')
      return standardDomTypePath('js.html.AnchorElement', 'HTMLAnchorElement');
    if (path.sub == null && qualified == 'genes.react.DialogElement')
      return standardDomTypePath('js.html.DialogElement', 'HTMLDialogElement');
    if (path.sub == null && qualified == 'genes.react.InputElement')
      return standardDomTypePath('js.html.InputElement', 'HTMLInputElement');
    if (path.sub == null && qualified == 'genes.react.SvgElement')
      return standardDomTypePath('js.html.svg.Element', 'SVGElement');
    return {
      pack: path.pack.copy(),
      name: path.name,
      params: path.params == null ? null : [
        for (parameter in path.params)
          switch parameter {
            case TPType(parameterType):
              TPType(projectBrowserFacades(parameterType));
            case TPExpr(expression):
              TPExpr(expression);
          }
      ],
      sub: path.sub
    };
  }

  static function standardDomTypePath(modulePath: String,
      nativeName: String): TypePath {
    final segments = modulePath.split('.');
    final moduleName = segments[segments.length - 1];
    segments.pop();
    var resolvedName: Null<String> = null;
    for (candidate in Context.getModule(modulePath)) {
      switch candidate {
        case TInst(classRef, _):
          final owner = classRef.get();
          if (owner.module == modulePath
            && (owner.name == moduleName || owner.name == nativeName))
            resolvedName = owner.name;
        default:
      }
    }
    if (resolvedName == null)
      Context.error('Genes HXX could not resolve the standard DOM type '
        + '$modulePath.$nativeName',
        Context.currentPos());
    return {
      pack: segments,
      name: moduleName,
      sub: resolvedName == nativeName ? nativeName : null
    };
  }

  static function componentPropsType(type: Type): Null<Type> {
    final resolved = resolveAliases(type);
    return switch resolved {
      case TFun(arguments, _) if (arguments.length == 1): arguments[0].t;
      case TFun(arguments, _) if (arguments.length == 0):
        null;
      case TInst(classRef, parameters)
        if (hasMeta(classRef.get().meta, 'genes.jsxComponentProps')):
        metadataPropsType(classRef.get(), parameters);
      case TInst(classRef, [TInst(componentRef, parameters)])
        if (classRef.get().pack.length == 0
          && classRef.get().name == 'Class'
          && hasMeta(componentRef.get().meta, 'genes.jsxComponentProps')):
        metadataPropsType(componentRef.get(), parameters);
      case TAbstract(classRef, [TInst(componentRef, parameters)])
        if (classRef.get().pack.length == 0
          && classRef.get().name == 'Class'
          && hasMeta(componentRef.get().meta, 'genes.jsxComponentProps')):
        metadataPropsType(componentRef.get(), parameters);
      case TAbstract(abstractRef, parameters)
        if (hasMeta(abstractRef.get().meta, 'genes.jsxComponentProps')):
        metadataPropsType(abstractRef.get(), parameters);
      case TAnonymous(anonymous):
        switch anonymous.get().status {
          case AClassStatics(componentRef)
            if (hasMeta(componentRef.get().meta, 'genes.jsxComponentProps')):
            metadataPropsType(componentRef.get(), []);
          default: null;
        }
      default: null;
    }
  }

  static function metadataPropsType(base: BaseType,
      parameters: Array<Type>): Null<Type> {
    final entries = metadata(base.meta, 'genes.jsxComponentProps');
    return switch entries {
      case [{params: [{expr: EConst(CInt(value, _))}]}]: final parsed = Std.parseInt(value); parsed == null || parsed < 0 || parsed >= parameters.length ? null : parameters[parsed];
      case [{params: [{expr: EConst(CString(path, _))}]}]
        if (StringTools.trim(path).length > 0):
        Context.getType(path);
      default: null;
    }
  }

  static function intrinsicPropsType(name: String): Null<Type> {
    final configured = Context.definedValue('genes.react.jsx_intrinsic_providers');
    final paths = configured == null
      || StringTools.trim(configured)
        .length == 0 ? [DEFAULT_INTRINSIC_PROVIDER] : [for (path in configured.split(',')) StringTools.trim(path)];
    for (path in paths) {
      final provider = resolveAliases(Context.getType(path));
      final classType = switch provider {
        case TInst(classRef, _): classRef.get();
        default: continue;
      };
      for (field in classType.statics.get()) {
        final declared = metadataString(field.meta, 'genes.jsxIntrinsic');
        if (declared == name)
          return field.type;
      }
    }
    return null;
  }

  static function propertyFields(type: Type): Null<Map<String, Type>> {
    return switch resolveAliases(type) {
      case TAnonymous(anonymous):
        [for (field in anonymous.get().fields) field.name => field.type];
      case TInst(classRef, parameters):
        final classType = classRef.get();
        if (!classType.isExtern && !classType.isInterface) null; else
          classPropertyFields(classType, parameters, 0);
      default: null;
    }
  }

  /** Mirrors Haxe's inherited extern/interface property surface. */
  static function classPropertyFields(classType: ClassType,
      parameters: Array<Type>, depth: Int): Map<String, Type> {
    if (depth > 64)
      return [];
    final out: Map<String, Type> = [];
    if (classType.superClass != null) {
      final relation = classType.superClass;
      final inherited = classPropertyFields(relation.t.get(), [
        for (parameter in relation.params)
          TypeTools.applyTypeParameters(parameter, classType.params, parameters)
      ], depth + 1);
      for (name => fieldType in inherited)
        out.set(name, fieldType);
    }
    for (relation in classType.interfaces) {
      final inherited = classPropertyFields(relation.t.get(), [
        for (parameter in relation.params)
          TypeTools.applyTypeParameters(parameter, classType.params, parameters)
      ], depth + 1);
      for (name => fieldType in inherited)
        out.set(name, fieldType);
    }
    for (field in classType.fields.get())
      if (field.isPublic)
        out.set(field.name,
          TypeTools.applyTypeParameters(field.type, classType.params,
            parameters));
    return out;
  }

  static function bindTypeParameters(actual: Type, expected: Type,
      bindings: Map<String, Type>, depth: Int): Void {
    if (depth > 64)
      return;
    final target = unwrapNullable(resolveAliases(expected));
    switch target {
      case TMono(reference) if (reference.get() == null):
        Context.unify(actual, target);
        return;
      case TInst(parameterRef, _)
        if (parameterRef.get().kind.match(KTypeParameter(_))):
        final key = typeParameterKey(parameterRef.get());
        if (!bindings.exists(key))
          bindings.set(key, actual);
        return;
      default:
    }

    final source = unwrapNullable(resolveAliases(actual));
    switch [source, target] {
      case [TInst(actualRef,
        actualParameters), TInst(expectedRef, expectedParameters)]
        if (sameBase(actualRef.get(), expectedRef.get())
          && actualParameters.length == expectedParameters.length):
        for (index in 0...actualParameters.length)
          bindTypeParameters(actualParameters[index],
            expectedParameters[index], bindings, depth + 1);
      case [
        TAbstract(actualRef, actualParameters),
        TAbstract(expectedRef, expectedParameters)
      ]
        if (sameBase(actualRef.get(), expectedRef.get())
          && actualParameters.length == expectedParameters.length):
        for (index in 0...actualParameters.length)
          bindTypeParameters(actualParameters[index],
            expectedParameters[index], bindings, depth + 1);
      case [TAnonymous(actualRef), TAnonymous(expectedRef)]:
        final actualFields = [
          for (field in actualRef.get().fields)
            field.name => field.type
        ];
        for (field in expectedRef.get().fields) {
          final found = actualFields.get(field.name);
          if (found != null)
            bindTypeParameters(found, field.type, bindings, depth + 1);
        }
      default:
    }
  }

  static function substitute(type: Type, bindings: Map<String, Type>,
      depth: Int): Type {
    if (depth > 64)
      return type;
    return switch type {
      case TInst(parameterRef, _)
        if (parameterRef.get().kind.match(KTypeParameter(_))
          && bindings.exists(typeParameterKey(parameterRef.get()))):
        bindings.get(typeParameterKey(parameterRef.get()));
      default:
        TypeTools.map(type, child -> substitute(child, bindings, depth + 1));
    }
  }

  static function containsTypeParameter(type: Type, depth: Int): Bool {
    if (depth > 64)
      return true;
    return switch resolveAliases(type) {
      case TMono(reference) if (reference.get() == null): true;
      case TInst(classRef, _) if (classRef.get().kind.match(KTypeParameter(_))):
        true;
      case compound:
        var found = false;
        TypeTools.iter(compound, child -> {
          if (!found && containsTypeParameter(child, depth + 1))
            found = true;
        });
        found;
    }
  }

  static function canProbe(expression: Expr): Bool {
    return switch expression.expr {
      case EConst(_): true;
      case EArray(owner, index): canProbe(owner) && canProbe(index);
      case EField(owner, _): canProbe(owner);
      case EArrayDecl(values): allProbeSafe(values);
      case EObjectDecl(fields): allProbeSafe([for (field in fields) field.expr]);
      case EBinop(_, left, right): canProbe(left) && canProbe(right);
      case EUnop(_, _, value): canProbe(value);
      case EParenthesis(inner) | ECheckType(inner, _): canProbe(inner);
      case EMeta(_, inner): canProbe(inner);
      default: false;
    }
  }

  static function allProbeSafe(expressions: Array<Expr>): Bool {
    for (expression in expressions)
      if (!canProbe(expression))
        return false;
    return true;
  }

  /**
   * Contextual typing is only needed for lambdas whose parameter types are
   * wholly implicit. An explicit annotation is the author's contract and must
   * reach `JsxTypeChecker` unchanged. Likewise, zero-argument callbacks are a
   * valid JavaScript/TypeScript way to ignore a supplied event; wrapping them
   * in Haxe's exact function type would reject that sound callback early.
   */
  static function isContextualFunction(expression: Expr): Bool {
    return switch expression.expr {
      case EFunction(_, fn): fn.args.length > 0 && fn.ret == null && !Lambda.exists(fn.args,
          argument -> argument.type != null);
      case EParenthesis(inner) | EMeta(_, inner) | ECheckType(inner, _):
        isContextualFunction(inner);
      default: false;
    }
  }

  /**
   * Selects the one callback arm that can contextually type a Haxe lambda.
   *
   * A closed property union such as `String | FormAction` has one callable
   * member. Its arguments are safe to project into the lambda, but its return
   * union must stay inferred: Haxe cannot use a host-style `Void | Promise`
   * class as a whole-function type hint. The later `JsxTypeChecker` still
   * validates the complete inferred function against every union arm.
   */
  static function contextualFunction(type: Type, arity: Int,
      insideUnion: Bool, depth: Int): Null<JsxContextFunction> {
    if (depth > 64)
      return null;
    final resolved = resolveAliases(type);
    return switch resolved {
      case TFun(arguments, _) if (arguments.length == arity): {
          type: resolved,
          argumentsOnly: insideUnion
        };
      default:
        final members = unionMembers(resolved);
        if (members == null) null; else {
          final matches: Array<JsxContextFunction> = [];
          for (member in members) {
            final found = contextualFunction(member, arity, true, depth + 1);
            if (found != null)
              matches.push(found);
          }
          matches.length == 1 ? matches[0] : null;
        }
    };
  }

  /** Adds expected parameter types without constraining an inferred result. */
  static function annotateFunctionArguments(expression: Expr,
      expected: Type): Null<Expr> {
    final arguments = switch resolveAliases(expected) {
      case TFun(found, _): found;
      default: return null;
    };
    return switch expression.expr {
      case EFunction(kind, fn) if (fn.args.length == arguments.length):
        final rewritten: Array<FunctionArg> = [];
        for (index in 0...fn.args.length) {
          final argument = fn.args[index];
          final complex = contextualComplexType(arguments[index].t);
          if (complex == null)
            return null;
          rewritten.push({
            name: argument.name,
            opt: argument.opt,
            type: complex,
            value: argument.value,
            meta: argument.meta
          });
        }
        {
          expr: EFunction(kind, {
            args: rewritten,
            ret: fn.ret,
            expr: fn.expr,
            params: fn.params
          }),
          pos: expression.pos
        };
      case EParenthesis(inner):
        final rewritten = annotateFunctionArguments(inner, expected);
        rewritten == null ? null : {
          expr: EParenthesis(rewritten),
          pos: expression.pos
        };
      case EMeta(meta, inner):
        final rewritten = annotateFunctionArguments(inner, expected);
        rewritten == null ? null : {
          expr: EMeta(meta, rewritten),
          pos: expression.pos
        };
      case ECheckType(inner, checked):
        final rewritten = annotateFunctionArguments(inner, expected);
        rewritten == null ? null : {
          expr: ECheckType(rewritten, checked),
          pos: expression.pos
        };
      default: null;
    };
  }

  static function functionArity(expression: Expr): Null<Int> {
    return switch expression.expr {
      case EFunction(_, fn): fn.args.length;
      case EParenthesis(inner) | EMeta(_, inner) | ECheckType(inner, _):
        functionArity(inner);
      default: null;
    }
  }

  static function unwrapNullable(type: Type): Type {
    return switch resolveAliases(type) {
      case TAbstract(abstractRef, [inner])
        if (abstractRef.get().pack.length == 0
          && abstractRef.get().name == 'Null'):
        unwrapNullable(inner);
      case TAbstract(abstractRef, [inner])
        if (abstractRef.get().module == 'genes.ts.Undefinable'
          && abstractRef.get().name == 'Undefinable'):
        // `undefined` and `null` are non-callable alternatives around the ref
        // callback. Remove only those absence wrappers while choosing a
        // contextual function arm; the later HXX checker still validates the
        // complete property union and keeps explicit null distinct.
        unwrapNullable(inner);
      case resolved: resolved;
    }
  }

  /** Closed HXX unions share the checker contract used by `JsxTypeChecker`. */
  static function unionMembers(type: Type): Null<Array<Type>> {
    return switch resolveAliases(type) {
      case TInst(classRef, parameters)
        if (hasMeta(classRef.get().meta, 'genes.jsxUnion')):
        parameters;
      case TAbstract(abstractRef, parameters)
        if (abstractRef.get().pack.join('.') == 'haxe.extern'
          && abstractRef.get().name == 'EitherType'):
        parameters;
      default: null;
    }
  }

  static function resolveAliases(type: Type): Type {
    return switch type {
      case TType(_, _) | TLazy(_): resolveAliases(Context.follow(type));
      case TMono(reference) if (reference.get() != null):
        resolveAliases(reference.get());
      default: type;
    }
  }

  static function sameBase(left: BaseType, right: BaseType): Bool {
    return left.module == right.module && left.name == right.name;
  }

  static function typeParameterKey(type: ClassType): String {
    final info = Context.getPosInfos(type.pos);
    return '${type.module}:${type.name}:${info.file}:${info.min}';
  }

  static function metadataString(meta: MetaAccess, name: String): Null<String> {
    for (entry in metadata(meta, name))
      switch entry.params {
        case [{expr: EConst(CString(value, _))}]:
          return value;
        default:
      }
    return null;
  }

  static function hasMeta(meta: MetaAccess, name: String): Bool {
    return metadata(meta, name).length > 0;
  }

  static function metadata(meta: MetaAccess,
      name: String): Array<MetadataEntry> {
    if (meta == null)
      return [];
    final colon = StringTools.startsWith(name, ':') ? name : ':$name';
    final direct = StringTools.startsWith(name, ':') ? name.substr(1) : name;
    return meta.extract(colon).concat(meta.extract(direct));
  }
}
#end
