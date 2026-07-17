package genes.js;

#if macro
import haxe.macro.Compiler;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.ExprTools;
import haxe.macro.Type;

using haxe.macro.TypeTools;

/** Compile-only function role used to validate the innermost await owner. */
private enum FunctionContextKind {
  SynchronousFunction;
  AnonymousAsyncFunction;
  NamedAsyncFunction;
}

private typedef FunctionContextRange = {
  final file:String;
  final min:Int;
  final max:Int;
  final kind:FunctionContextKind;
}
#end

/**
 * Provides typed Haxe authoring for native JavaScript/TypeScript async code.
 *
 * Why: Haxe 4 has no native async function effect, so a normal Haxe method
 * cannot express that its body returns `T` while callers receive `Promise<T>`.
 *
 * What: `@:async` marks named or anonymous functions, while `await(...)` and
 * `@:await expression` unwrap typed `js.lib.Promise` values. Both classic
 * Genes and genes-ts emit native `async`/`await`; no Promise-chain simulation
 * or magic source marker is involved.
 *
 * How: a build macro rewrites return typing, records private function-context
 * ranges, and attaches the typed `:jsAsync` fact consumed by both emitters.
 * Calls fail during typing when they are outside an async function. Named
 * async methods additionally require an active Genes generator because only
 * the Genes printers consume `:jsAsync`; anonymous async functions lower to
 * explicit syntax and remain valid in stock Haxe JS.
 *
 * Usage:
 * - Mark functions with `@:async` metadata.
 * - Import the macro `await` function: `import genes.js.Async.await;`
 * - Use `await(promiseExpr)` inside `@:async` functions.
 * - Or use `@:await promiseExpr` inside `@:async` functions when metadata
 *   syntax reads closer to the target TypeScript.
 *
 * `@:async` functions must declare a return type. A declared `T` is lifted to
 * `Promise<T>`; an existing `Promise<T>` remains unchanged. The compile-only
 * casts used to bridge Haxe's missing async effect are documented at the
 * rewrite site and are erased from generated user code.
 */
class Async {
  #if macro
  static inline final ASYNC_CONTEXT_METADATA = ':genes.asyncContext';
  #end

  /** Installs the compile-local build macro used by the library HXML. */
  public static function enable(): Void {
    #if macro
    Compiler.addGlobalMetadata('',
      '@:build(genes.js.Async.build())', true, true, false);
    #end
  }

  /**
   * Rewrites async authoring syntax before Haxe types each class.
   *
   * The returned fields retain ordinary Haxe expressions and private metadata;
   * no process-global occurrence table is used, so compile-server reuse cannot
   * leak async ownership between compilations.
   */
  public static macro function build(): Array<Field> {
    final fields = Context.getBuildFields();
    final localClass = Context.getLocalClass();
    // The global hook also reaches this helper's target-side class after its
    // macro side has been loaded. Rewriting that class would ask Haxe to return
    // an already-compiled macro function from a build macro. Async authoring
    // semantics never belong to the helper implementation itself.
    if (localClass != null && localClass.get().module == 'genes.js.Async')
      return fields;
    final transformed: Array<Field> = [];

    for (field in fields) {
      var isMacroField = false;
      if (field.access != null) {
        for (access in field.access) {
          if (access == AMacro) {
            isMacroField = true;
            break;
          }
        }
      }
      // Macro functions execute in a separate compiler context and cannot be
      // native JavaScript async functions. Returning a rewritten macro field
      // after its owner was loaded by another macro is also rejected by Haxe.
      if (isMacroField) {
        transformed.push(field);
        continue;
      }
      final asyncRanges:Array<FunctionContextRange> = [];
      switch field.kind {
        case FFun(fn):
          if (fn == null) {
            transformed.push(field);
            continue;
          }

          if (hasAsyncMeta(field.meta)) {
            transformed.push(withAsyncContextRanges(
              transformAsyncField(field, fn, asyncRanges), asyncRanges));
          } else {
            fn.args = processFunctionArgs(fn.args, asyncRanges);
            if (fn.expr != null)
              fn.expr = processExpression(fn.expr, false, asyncRanges);
            transformed.push(withAsyncContextRanges(field, asyncRanges));
          }

        case FVar(t, e):
          if (e != null) {
            final newExpr = processExpression(e, false, asyncRanges);
            transformed.push(withAsyncContextRanges({
              name: field.name,
              doc: field.doc,
              access: field.access,
              kind: FVar(t, newExpr),
              pos: field.pos,
              meta: field.meta
            }, asyncRanges));
          } else
            transformed.push(field);

        case FProp(get, set, t, e):
          if (e != null) {
            final newExpr = processExpression(e, false, asyncRanges);
            transformed.push(withAsyncContextRanges({
              name: field.name,
              doc: field.doc,
              access: field.access,
              kind: FProp(get, set, t, newExpr),
              pos: field.pos,
              meta: field.meta
            }, asyncRanges));
          } else
            transformed.push(field);

        default:
          transformed.push(field);
      }
    }

    return transformed;
  }

  /** Unwraps one Promise only after validating target and lexical ownership. */
  public static macro function await(expr: Expr): Expr {
    final callPos = Context.currentPos();
    if (requireAsyncContext(callPos))
      requireGenesGenerator(callPos);
    return awaitExpression(expr);
  }

  #if macro
  /**
   * Lowers one Promise expression to native JS/TS `await`.
   *
   * Why: this is the typed primitive behind `await(promise)`. Metadata-style
   * `@:await promise` is desugared to a call to this macro later, after the
   * build macro has returned and method locals are in scope.
   *
   * What/How: Haxe still sees a typed expression. The emitted primitive is
   * `await <promise>`, check-typed to the Promise element type when possible.
   * Because the primitive is carried through `js.Syntax.code`, both emitters'
   * shared raw-syntax receiver rule must add an expression boundary when the
   * result is followed by member/index access: `(await promise).field`, never
   * `await promise.field`. The only Dynamic fallback is the existing
   * js.Syntax boundary for cases where Haxe cannot materialize a ComplexType
   * from the awaited expression.
   */
  static function awaitExpression(expr: Expr): Expr {
    final typed = Context.typeExpr(expr);
    final awaitedType = unwrapPromiseType(typed.t);
    // `js.Syntax.code()` returns `Dynamic`, which cannot be checked to `Void`.
    // For `Promise<Void>`, avoid adding a `Void` check-type and rely on the
    // expression being used for side effects only.
    if (isVoidType(awaitedType))
      return macro @:pos(expr.pos) js.Syntax.code('await {0}', $expr);
    final ct = awaitedType.toComplexType();
    if (ct == null)
      return macro @:pos(expr.pos) (js.Syntax.code('await {0}', $expr): Dynamic);
    final awaitedExpr = macro js.Syntax.code('await {0}', $expr);
    awaitedExpr.pos = expr.pos;
    return {
      expr: ECheckType(awaitedExpr, ct),
      pos: expr.pos
    };
  }

  /**
   * Records typed-field ownership for every source-level async function.
   *
   * Why: `await(...)` expands after the build macro, when Haxe exposes the
   * enclosing named field but not an explicit anonymous-function stack. A
   * process-global range table would leak through compile-server reuse.
   *
   * What: each outer field receives private metadata containing the file,
   * source offsets, and async/synchronous role of every relevant function.
   * The public await macro chooses the innermost function containing its call
   * and accepts the call only when that function is async.
   *
   * How: the fact travels on the field that Haxe is already typing. It has no
   * runtime representation, is ignored by both emitters, and is recreated for
   * each compilation, so nested anonymous functions work without mutable
   * compiler-global state.
   */
  static function withAsyncContextRanges(field:Field,
      ranges:Array<FunctionContextRange>):Field {
    if (ranges.length == 0)
      return field;
    final meta = field.meta == null ? [] : field.meta.copy();
    for (range in ranges) {
      meta.push({
        name: ASYNC_CONTEXT_METADATA,
        params: [
          macro $v{range.file},
          macro $v{range.min},
          macro $v{range.max},
          macro $v{functionContextName(range.kind)}
        ],
        pos: field.pos
      });
    }
    return {
      name: field.name,
      doc: field.doc,
      access: field.access,
      kind: field.kind,
      pos: field.pos,
      meta: meta
    };
  }

  static function addFunctionSourceRange(ranges:Array<FunctionContextRange>,
      pos:Position, kind:FunctionContextKind):Void {
    final info = Context.getPosInfos(pos);
    for (existing in ranges) {
      if (existing.file == info.file && existing.min == info.min
        && existing.max == info.max && existing.kind == kind)
        return;
    }
    ranges.push({
      file: info.file,
      min: info.min,
      max: info.max,
      kind: kind
    });
  }

  static function functionContextName(kind:FunctionContextKind):String {
    return switch kind {
      case SynchronousFunction: 'sync';
      case AnonymousAsyncFunction: 'anonymous-async';
      case NamedAsyncFunction: 'named-async';
    };
  }

  /**
   * Stops async authoring from publishing syntactically invalid stock-Haxe JS.
   *
   * The active-generator define is private, compile-local capability evidence.
   * Checking `genes.disable` alone would miss manual classpath use and could
   * accept a build whose printer never sees the `:jsAsync` semantic fact.
   */
  static function requireGenesGenerator(pos:Position):Void {
    requireJsTarget(pos);
    if (!Context.defined(genes.CompilerInternal.GENERATOR_ACTIVE_DEFINE)) {
      Context.error(
        '[GENES-ASYNC-TARGET-001] named @:async methods require the active Genes JS generator',
        pos);
    }
  }

  /** Rejects native async syntax on targets that cannot execute JavaScript. */
  static function requireJsTarget(pos:Position):Void {
    if (!Context.defined('js')) {
      Context.error(
        '[GENES-ASYNC-TARGET-001] @:async and await require the JavaScript target',
        pos);
    }
  }

  /**
   * Requires an await expression to belong to its innermost async function.
   *
   * Source containment alone is not enough: a normal nested function lies
   * inside its async parent's range but cannot contain `await`. Selecting the
   * smallest recorded function/default-expression range preserves that lexical
   * boundary without a mutable macro registry.
   */
  static function requireAsyncContext(pos:Position):Bool {
    final localClass = Context.getLocalClass();
    final info = Context.getPosInfos(pos);
    var nearestKind:Null<String> = null;
    var nearestSpan = -1;
    final fields = localClass == null
      ? []
      : localClass.get().fields.get().concat(localClass.get().statics.get());
    for (field in fields) {
      for (entry in field.meta.extract(ASYNC_CONTEXT_METADATA)) {
        switch entry.params {
          case [
            {expr: EConst(CString(file))},
            {expr: EConst(CInt(minValue))},
            {expr: EConst(CInt(maxValue))},
            {expr: EConst(CString(kind))}
          ]:
            final min = Std.parseInt(minValue);
            final max = Std.parseInt(maxValue);
            if (min != null && max != null && file == info.file
              && info.min >= min && info.max <= max) {
              final span = max - min;
              if (nearestSpan < 0 || span < nearestSpan) {
                nearestSpan = span;
                nearestKind = kind;
              }
            }
          default:
        }
      }
    }
    return switch nearestKind {
      case 'anonymous-async': false;
      case 'named-async': true;
      default:
        Context.error(
          '[GENES-ASYNC-CONTEXT-001] await(...) and @:await require an enclosing @:async function',
          pos);
    };
  }

  static function hasAsyncMeta(meta: Metadata): Bool {
    if (meta == null)
      return false;
    for (entry in meta) {
      if (entry.name == ':async' || entry.name == 'async')
        return true;
    }
    return false;
  }

  static function removeAsyncMeta(meta: Metadata): Metadata {
    if (meta == null)
      return null;
    final out: Metadata = [];
    for (entry in meta) {
      if (entry.name == ':async' || entry.name == 'async')
        continue;
      out.push(entry);
    }
    return out;
  }

  static function addJsAsyncMeta(meta: Metadata, pos: Position): Metadata {
    final out = meta != null ? meta : [];
    out.push({name: ':jsAsync', params: [], pos: pos});
    return out;
  }

  static function isJsPromiseType(t: ComplexType, pos: Position,
      ?params: Array<TypeParamDecl>): Bool {
    final resolved = Context.resolveType(eraseLocalTypeParams(t, params), pos);
    return switch Context.followWithAbstracts(resolved) {
      case TInst(_.get() => {module: 'js.lib.Promise', name: 'Promise'}, _):
        true;
      default:
        false;
    }
  }

  static function toJsPromiseType(inner: ComplexType): ComplexType {
    return TPath({
      name: 'Promise',
      pack: ['js', 'lib'],
      params: [TPType(inner)]
    });
  }

  static function promiseInnerType(promise: ComplexType, pos: Position,
      ?params: Array<TypeParamDecl>): Type {
    final resolved = Context.resolveType(eraseLocalTypeParams(promise, params),
      pos);
    return switch Context.followWithAbstracts(resolved) {
      case TInst(_.get() => {module: 'js.lib.Promise', name: 'Promise'}, [inner]):
        inner;
      case TInst(_.get() => {module: 'js.lib.Promise', name: 'Promise'}, []):
        resolved;
      default:
        Context.error('Expected js.lib.Promise return type', pos);
    }
  }

  static function isVoidType(t: Type): Bool {
    return switch Context.followWithAbstracts(t) {
      case TAbstract(_.get() => {name: 'Void', pack: []}, _):
        true;
      default:
        false;
    }
  }

  /**
   * Preserves generic async signatures while letting the macro inspect Promise
   * shape outside the method's local type-parameter scope.
   *
   * Why: build macros run while rewriting a field declaration. A method-local
   * parameter such as `function id<T>(v:T): Promise<T>` is valid Haxe, but
   * `Context.resolveType()` cannot resolve that `T` from the macro helper's
   * scope. The async transform only needs to know whether the declared return is
   * a `js.lib.Promise` and whether its inner type is `Void`; it must not erase
   * or rewrite the actual function signature.
   *
   * What/How: before macro-only Promise inspection, replace references to the
   * current function's local type parameters with `Dynamic` in a copy of the
   * `ComplexType`. The transformed field still uses the original `ComplexType`
   * and `fn.params`, so generated Haxe/TS surfaces keep `Promise<T>`.
   */
  static function eraseLocalTypeParams(t: ComplexType,
      ?params: Array<TypeParamDecl>): ComplexType {
    if (params == null || params.length == 0)
      return t;
    final names = new Map<String, Bool>();
    for (param in params)
      names.set(param.name, true);
    return eraseLocalTypeParamRefs(t, names);
  }

  static function eraseLocalTypeParamRefs(t: ComplexType,
      names: Map<String, Bool>): ComplexType {
    return switch t {
      case TPath(path) if (path.pack.length == 0 && names.exists(path.name)):
        macro: Dynamic;
      case TPath(path):
        TPath({
          pack: path.pack,
          name: path.name,
          sub: path.sub,
          params: path.params.map(param -> switch param {
            case TPType(inner): TPType(eraseLocalTypeParamRefs(inner, names));
            case TPExpr(expr): TPExpr(expr);
          })
        });
      case TFunction(args, ret):
        TFunction(args.map(arg -> eraseLocalTypeParamRefs(arg, names)),
          eraseLocalTypeParamRefs(ret, names));
      case TAnonymous(fields):
        TAnonymous(fields.map(field -> eraseFieldLocalTypeParams(field, names)));
      case TParent(inner):
        TParent(eraseLocalTypeParamRefs(inner, names));
      case TOptional(inner):
        TOptional(eraseLocalTypeParamRefs(inner, names));
      case TNamed(name, inner):
        TNamed(name, eraseLocalTypeParamRefs(inner, names));
      case TExtend(paths, fields):
        TExtend(paths, fields.map(field -> eraseFieldLocalTypeParams(field,
          names)));
      case TIntersection(types):
        TIntersection(types.map(inner -> eraseLocalTypeParamRefs(inner, names)));
    }
  }

  static function eraseFieldLocalTypeParams(field: Field,
      names: Map<String, Bool>): Field {
    return {
      name: field.name,
      doc: field.doc,
      meta: field.meta,
      access: field.access,
      kind: eraseFieldKindLocalTypeParams(field.kind, names),
      pos: field.pos
    };
  }

  static function eraseFieldKindLocalTypeParams(kind: haxe.macro.Expr.FieldType,
      names: Map<String, Bool>): haxe.macro.Expr.FieldType {
    return switch kind {
      case FVar(ct, e):
        FVar(ct == null ? null : eraseLocalTypeParamRefs(ct, names), e);
      case FProp(get, set, ct, e):
        FProp(get, set,
          ct == null ? null : eraseLocalTypeParamRefs(ct, names), e);
      case FFun(fn):
        FFun({
          args: fn.args.map(arg -> {
            name: arg.name,
            opt: arg.opt,
            type: arg.type == null ? null : eraseLocalTypeParamRefs(arg.type,
              names),
            value: arg.value,
            meta: arg.meta
          }),
          ret: fn.ret == null ? null : eraseLocalTypeParamRefs(fn.ret, names),
          expr: fn.expr,
          params: fn.params
        });
    }
  }

  static inline function isAwaitMeta(meta: MetadataEntry): Bool {
    return meta.name == ':await' || meta.name == 'await';
  }

  /**
   * Desugars `@:await expr` to the existing `genes.js.Async.await(expr)` macro.
   *
   * This must stay syntax-only. Build macros run before method-local typing, so
   * typing `inner` here would fail for locals introduced in the async function.
   * The quoted macro call is typed later in the original lexical scope, where
   * the existing await macro can infer Promise<T> correctly.
   */
  static function lowerAwaitMeta(whole: Expr, meta: MetadataEntry, inner: Expr,
      ranges:Array<FunctionContextRange>):Expr {
    if (meta.params.length > 0) {
      Context.error(
        '@:await does not take metadata arguments. Use `@:await expr`, `@:await (expr)` with a space, or `await(expr)`.',
        meta.pos);
    }

    final operand = processExpression(inner, true, ranges);
    final out = macro genes.js.Async.await($operand);
    out.pos = whole.pos;
    return out;
  }

  static function transformAsyncField(field:Field, fn:Function,
      ranges:Array<FunctionContextRange>):Field {
    if (field.name == 'new')
      Context.error(
        '[GENES-ASYNC-CONSTRUCTOR-001] @:async is not supported on constructors',
        field.pos);
    requireGenesGenerator(field.pos);
    addFunctionSourceRange(ranges,
      fn.expr == null ? field.pos : fn.expr.pos, NamedAsyncFunction);

    final newReturnType = switch fn.ret {
      case null:
        Context.error(
          '[GENES-ASYNC-RETURN-001] @:async functions must declare a return type',
          field.pos);
      case ret if (isJsPromiseType(ret, field.pos, fn.params)):
        ret;
      case ret:
        toJsPromiseType(ret);
    }

    final fnExpr = fn.expr != null
      ? processExpression(fn.expr, true, ranges)
      : null;
    final rewritten = fnExpr != null ? rewriteReturns(fnExpr) : fnExpr;

    final isVoidPromise = isVoidType(promiseInnerType(newReturnType, field.pos,
      fn.params));

    final ensured = isVoidPromise ? ensureVoidPromiseReturn(rewritten, field.pos) : rewritten;

    final newFunc: Function = {
      args: processFunctionArgs(fn.args, ranges),
      ret: newReturnType,
      expr: ensured,
      params: fn.params
    };

    final newMeta = addJsAsyncMeta(removeAsyncMeta(field.meta), field.pos);

    return {
      name: field.name,
      doc: field.doc,
      access: field.access,
      kind: FFun(newFunc),
      pos: field.pos,
      meta: newMeta
    };
  }

  static function processExpression(expr:Expr, insideAsync:Bool,
      ranges:Array<FunctionContextRange>):Expr {
    if (expr == null)
      return expr;

    return switch expr.expr {
      case EMeta(meta, inner) if (meta != null && isAwaitMeta(meta)):
        if (!insideAsync) {
          Context.error(
            '[GENES-ASYNC-CONTEXT-001] await(...) and @:await require an enclosing @:async function',
            expr.pos);
        }
        lowerAwaitMeta(expr, meta, inner, ranges);
      case EMeta(meta, inner) if (meta != null && (meta.name == ':async' || meta.name == 'async')):
        switch inner.expr {
          case EFunction(kind, fn):
            transformAsyncFunctionExpr(inner.pos, kind, fn, ranges);
          default:
            Context.error(
              '[GENES-ASYNC-AUTHORING-001] @:async can only be applied to functions',
              expr.pos);
        }
      case EFunction(kind, fn):
        // A normal nested function is a new async boundary even when it is
        // declared inside an async method. Its smallest source range wins over
        // the enclosing async range when the await macro validates placement.
        addFunctionSourceRange(ranges, expr.pos, SynchronousFunction);
        {
          expr: EFunction(kind, {
            args: processFunctionArgs(fn.args, ranges),
            ret: fn.ret,
            expr: fn.expr == null
              ? null
              : processExpression(fn.expr, false, ranges),
            params: fn.params
          }),
          pos: expr.pos
        };
      default:
        ExprTools.map(expr,
          child -> processExpression(child, insideAsync, ranges));
    }
  }

  /**
   * Processes parameter defaults outside the async body contract.
   *
   * JavaScript does not allow `await` in an async function's parameter
   * initializer. Recording each default as a synchronous source range also
   * keeps direct `await(...)` macro calls from inheriting the surrounding
   * function's async permission when Haxe types them later.
   */
  static function processFunctionArgs(args:Array<FunctionArg>,
      ranges:Array<FunctionContextRange>):Array<FunctionArg> {
    return args.map(arg -> {
      if (arg.value != null)
        addFunctionSourceRange(ranges, arg.value.pos, SynchronousFunction);
      {
        name: arg.name,
        opt: arg.opt,
        type: arg.type,
        value: arg.value == null
          ? null
          : processExpression(arg.value, false, ranges),
        meta: arg.meta
      };
    });
  }

  static function transformAsyncFunctionExpr(pos:Position,
      kind:Null<FunctionKind>, fn:Function,
      ranges:Array<FunctionContextRange>):Expr {
    requireJsTarget(pos);
    addFunctionSourceRange(ranges, pos, AnonymousAsyncFunction);
    final newReturnType = switch fn.ret {
      case null:
        Context.error(
          '[GENES-ASYNC-RETURN-001] @:async functions must declare a return type',
          pos);
      case ret if (isJsPromiseType(ret, pos, fn.params)):
        ret;
      case ret:
        toJsPromiseType(ret);
    }

    final fnExpr = fn.expr != null
      ? processExpression(fn.expr, true, ranges)
      : null;
    final rewritten = fnExpr != null ? rewriteReturns(fnExpr) : fnExpr;

    final isVoidPromise = isVoidType(promiseInnerType(newReturnType, pos,
      fn.params));
    final ensured = isVoidPromise ? ensureVoidPromiseReturn(rewritten, pos) : rewritten;

    final newFunc: Function = {
      args: processFunctionArgs(fn.args, ranges),
      ret: newReturnType,
      expr: ensured,
      params: fn.params
    };

    final fnExprOut: Expr = {
      expr: EFunction(kind, newFunc),
      pos: pos
    };

    final fnType: ComplexType = TFunction([
      for (arg in newFunc.args)
        // An anonymous argument without a source type gives Haxe no stronger
        // contract to preserve here. Keep that existing weakness inside this
        // macro-only check type; explicitly typed arguments remain precise,
        // and generated user modules do not receive an added Dynamic/any.
        arg.type != null ? arg.type : (macro: Dynamic)
    ], newReturnType);

    final out = macro js.Syntax.code('async {0}', $fnExprOut);
    out.pos = pos;
    return {expr: ECheckType(out, fnType), pos: pos};
  }

  /**
   * Bridges Haxe's synchronous return type to native async function semantics.
   *
   * Why: Haxe checks the rewritten field as `Promise<T>`, while the body of a
   * native JavaScript async function returns `T`. Haxe has no async effect type
   * that can express this relationship directly.
   *
   * What/How: `ECast` is a compile-time-only bridge around each source return;
   * both Genes emitters erase it and print the original precise expression.
   * Returns inside nested functions are deliberately untouched. Keep this cast
   * contained here until Haxe can type native async bodies directly.
   */
  static function rewriteReturns(expr:Expr):Expr {
    if (expr == null)
      return expr;

    return switch expr.expr {
      case EFunction(_, _):
        // Do not rewrite returns inside nested function bodies.
        expr;
      case EReturn(v):
        final castedValue: Expr = {
          expr: ECast(v != null ? v : (macro js.Syntax.code('undefined')), null),
          pos: expr.pos
        };
        {expr: EReturn(castedValue), pos: expr.pos};
      default:
        ExprTools.map(expr, rewriteReturns);
    }
  }

  /**
   * Adds the compile-only fallthrough return required for `Promise<Void>`.
   *
   * Haxe checks the transformed function as returning a Promise even though a
   * native async body completes with `undefined`. The narrowly scoped `ECast`
   * expresses that missing effect to Haxe; both Genes emitters erase the cast
   * and print a normal `return`, so no weak type reaches generated user code.
   */
  static function ensureVoidPromiseReturn(expr:Expr, pos:Position):Expr {
    final retExpr: Expr = {
      expr: EReturn({
        expr: ECast(macro js.Syntax.code('undefined'), null),
        pos: pos
      }),
      pos: pos
    };

    if (expr == null)
      return {expr: EBlock([retExpr]), pos: pos};

    return switch expr.expr {
      case EBlock(exprs):
        final out = exprs.copy();
        out.push(retExpr);
        {expr: EBlock(out), pos: expr.pos};
      default:
        {expr: EBlock([expr, retExpr]), pos: expr.pos};
    }
  }

  static function unwrapPromiseType(t: Type): Type {
    var cur = t;
    while (true) {
      switch Context.followWithAbstracts(cur) {
        case TInst(_.get() => {module: 'js.lib.Promise', name: 'Promise'}, [inner]):
          cur = inner;
        case _:
          return cur;
      }
    }
    return cur;
  }
  #end
}
