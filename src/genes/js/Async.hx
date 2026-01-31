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

  #if macro
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

  static function isJsPromiseType(t: ComplexType, pos: Position): Bool {
    final resolved = Context.resolveType(t, pos);
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

  static function promiseInnerType(promise: ComplexType, pos: Position): Type {
    final resolved = Context.resolveType(promise, pos);
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

  static function transformAsyncField(field: Field, fn: Function): Field {
    if (field.name == 'new')
      Context.error('@:async is not supported on constructors', field.pos);

    final newReturnType = switch fn.ret {
      case null:
        Context.error('@:async functions must declare a return type', field.pos);
      case ret if (isJsPromiseType(ret, field.pos)):
        ret;
      case ret:
        toJsPromiseType(ret);
    }

    final fnExpr = fn.expr != null ? processExpression(fn.expr) : null;
    final rewritten = fnExpr != null ? rewriteReturns(fnExpr) : fnExpr;

    final isVoidPromise = isVoidType(promiseInnerType(newReturnType, field.pos));

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
      case ret if (isJsPromiseType(ret, pos)):
        ret;
      case ret:
        toJsPromiseType(ret);
    }

    final fnExpr = fn.expr != null ? processExpression(fn.expr) : null;
    final rewritten = fnExpr != null ? rewriteReturns(fnExpr) : fnExpr;

    final isVoidPromise = isVoidType(promiseInnerType(newReturnType, pos));
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
