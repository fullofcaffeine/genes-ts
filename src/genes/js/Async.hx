package genes.js;

#if macro
import haxe.macro.Compiler;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.ExprTools;
import haxe.macro.Type;

using haxe.macro.TypeTools;
#end

/**
 * Async
 *
 * Opt-in async/await syntax sugar that compiles to native JS/TS `async` / `await`.
 *
 * Usage:
 * - Mark functions with `@:async` metadata.
 * - Import the macro `await` function: `import genes.js.Async.await;`
 * - Use `await(promiseExpr)` inside `@:async` functions.
 * - Or use `@:await promiseExpr` inside `@:async` functions when metadata
 *   syntax reads closer to the target TypeScript.
 *
 * Notes:
 * - `@:async` functions are rewritten to return `js.lib.Promise<T>` (TS: `Promise<T>`).
 * - `return x` is rewritten as `return cast x` so Haxe typechecks, while output stays idiomatic.
 */
class Async {
  public static function enable(): Void {
    #if macro
    Compiler.addGlobalMetadata('',
      '@:build(genes.js.Async.build())', true, true, false);
    #end
  }

  public static macro function build(): Array<Field> {
    final fields = Context.getBuildFields();
    final transformed: Array<Field> = [];

    for (field in fields) {
      switch field.kind {
        case FFun(fn):
          if (fn == null) {
            transformed.push(field);
            continue;
          }

          if (hasAsyncMeta(field.meta)) {
            transformed.push(transformAsyncField(field, fn));
          } else {
            if (fn.expr != null)
              fn.expr = processExpression(fn.expr);
            transformed.push(field);
          }

        case FVar(t, e):
          if (e != null) {
            final newExpr = processExpression(e);
            transformed.push({
              name: field.name,
              doc: field.doc,
              access: field.access,
              kind: FVar(t, newExpr),
              pos: field.pos,
              meta: field.meta
            });
          } else
            transformed.push(field);

        case FProp(get, set, t, e):
          if (e != null) {
            final newExpr = processExpression(e);
            transformed.push({
              name: field.name,
              doc: field.doc,
              access: field.access,
              kind: FProp(get, set, t, newExpr),
              pos: field.pos,
              meta: field.meta
            });
          } else
            transformed.push(field);

        default:
          transformed.push(field);
      }
    }

    return transformed;
  }

  public static macro function await(expr: Expr): Expr {
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
   * What/How: Haxe still sees a typed expression. The emitted code is
   * `await <promise>`, check-typed to the Promise element type when possible.
   * The only Dynamic fallback is the existing js.Syntax boundary for cases
   * where Haxe cannot materialize a ComplexType from the awaited expression.
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
  static function lowerAwaitMeta(whole: Expr, meta: MetadataEntry, inner: Expr): Expr {
    if (meta.params.length > 0) {
      Context.error(
        '@:await does not take metadata arguments. Use `@:await expr`, `@:await (expr)` with a space, or `await(expr)`.',
        meta.pos);
    }

    final operand = processExpression(inner);
    final out = macro genes.js.Async.await($operand);
    out.pos = whole.pos;
    return out;
  }

  static function transformAsyncField(field: Field, fn: Function): Field {
    if (field.name == 'new')
      Context.error('@:async is not supported on constructors', field.pos);

    final newReturnType = switch fn.ret {
      case null:
        Context.error('@:async functions must declare a return type', field.pos);
      case ret if (isJsPromiseType(ret, field.pos, fn.params)):
        ret;
      case ret:
        toJsPromiseType(ret);
    }

    final fnExpr = fn.expr != null ? processExpression(fn.expr) : null;
    final rewritten = fnExpr != null ? rewriteReturns(fnExpr) : fnExpr;

    final isVoidPromise = isVoidType(promiseInnerType(newReturnType, field.pos,
      fn.params));

    final ensured = isVoidPromise ? ensureVoidPromiseReturn(rewritten, field.pos) : rewritten;

    final newFunc: Function = {
      args: fn.args,
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

  static function processExpression(expr: Expr): Expr {
    if (expr == null)
      return expr;

    return switch expr.expr {
      case EMeta(meta, inner) if (meta != null && isAwaitMeta(meta)):
        lowerAwaitMeta(expr, meta, inner);
      case EMeta(meta, inner) if (meta != null && (meta.name == ':async' || meta.name == 'async')):
        switch inner.expr {
          case EFunction(kind, fn):
            final transformed = transformAsyncFunctionExpr(meta, inner.pos, kind, fn);
            // Process nested async functions too.
            ExprTools.map(transformed, processExpression);
          default:
            Context.error('@:async can only be applied to functions', expr.pos);
        }
      default:
        ExprTools.map(expr, processExpression);
    }
  }

  static function transformAsyncFunctionExpr(asyncMeta: MetadataEntry, pos: Position, kind: Null<FunctionKind>, fn: Function): Expr {
    final newReturnType = switch fn.ret {
      case null:
        Context.error('@:async functions must declare a return type', pos);
      case ret if (isJsPromiseType(ret, pos, fn.params)):
        ret;
      case ret:
        toJsPromiseType(ret);
    }

    final fnExpr = fn.expr != null ? processExpression(fn.expr) : null;
    final rewritten = fnExpr != null ? rewriteReturns(fnExpr) : fnExpr;

    final isVoidPromise = isVoidType(promiseInnerType(newReturnType, pos,
      fn.params));
    final ensured = isVoidPromise ? ensureVoidPromiseReturn(rewritten, pos) : rewritten;

    final newFunc: Function = {
      args: fn.args,
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
        arg.type != null ? arg.type : (macro: Dynamic)
    ], newReturnType);

    final out = macro js.Syntax.code('async {0}', $fnExprOut);
    out.pos = pos;
    return {expr: ECheckType(out, fnType), pos: pos};
  }

  static function rewriteReturns(expr: Expr): Expr {
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

  static function ensureVoidPromiseReturn(expr: Expr, pos: Position): Expr {
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
