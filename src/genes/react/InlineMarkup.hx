package genes.react;

#if macro
import haxe.macro.Compiler;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.ExprTools;
#end

/**
 * InlineMarkup
 *
 * Enables Haxe inline markup (`return <div>...</div>`) as syntax sugar for
 * `genes.react.JSX.jsx("...")` templates.
 *
 * Haxe represents inline markup as expression metadata `@:markup` applied to a
 * string constant. The typer errors on `@:markup` unless a macro rewrites it
 * beforehand, so we install a build macro (opt-in via defines).
 */
class InlineMarkup {
  public static function enable(): Void {
    Compiler.addGlobalMetadata('',
      '@:build(genes.react.InlineMarkup.build())', true, true, false);
  }

  public static macro function build(): Array<Field> {
    final fields = Context.getBuildFields();
    if (!Context.defined('genes.react.inline_markup')
      && !Context.defined('genes.react.inline_markup_all'))
      return fields;
    if (!shouldProcessLocalType())
      return fields;
    for (field in fields)
      rewriteField(field);
    return fields;
  }

  static function shouldProcessLocalType(): Bool {
    if (Context.defined('genes.react.inline_markup_all'))
      return true;
    final local = Context.getLocalClass();
    if (local == null)
      return false;
    final cl = local.get();
    if (cl == null || cl.meta == null)
      return false;
    return cl.meta.has(':jsx_inline_markup');
  }

  static function rewriteField(field: Field): Void {
    if (field == null)
      return;
    switch field.kind {
      case FFun(fn):
        if (fn != null && fn.expr != null)
          fn.expr = rewriteExpr(fn.expr);
      case FVar(t, e):
        if (e != null)
          field.kind = FVar(t, rewriteExpr(e));
      case FProp(get, set, t, e):
        if (e != null)
          field.kind = FProp(get, set, t, rewriteExpr(e));
    }
  }

  static function rewriteExpr(expr: Expr): Expr {
    if (expr == null)
      return expr;
    return switch expr.expr {
      case EMeta(meta, inner)
        if (meta != null && (meta.name == ':markup' || meta.name == 'markup')):
        final call = macro genes.react.JSX.jsx($inner);
        call.pos = expr.pos;
        call;
      default:
        ExprTools.map(expr, rewriteExpr);
    }
  }
}
