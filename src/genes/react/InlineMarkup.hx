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
 * WHAT
 * - Enables Haxe inline markup (`return <div>...</div>`) as the preferred
 *   HHX-style authoring surface for React/TSX output.
 * - Rewrites parser-produced `@:markup "<div>...</div>"` expressions into
 *   `genes.react.JSX.jsx("...")`, which then lowers into typed JSX marker calls.
 *
 * WHY
 * - Haxe parses inline markup, but leaves it as `@:markup` metadata wrapped
 *   around a string payload. The normal typer rejects that expression unless a
 *   build macro rewrites it first.
 * - Keeping markup at Haxe expression level lets `{...}` children and attribute
 *   values become real Haxe expressions, so Haxe and TypeScript both get a
 *   chance to validate the component/prop surface.
 *
 * HOW
 * - `extraParams.hxml` installs this build macro globally.
 * - In genes-ts builds (`-D genes.ts`), inline markup is default-on for every
 *   module and can be disabled with `-D genes.react.no_inline_markup` or
 *   `@:jsx_no_inline_markup`.
 * - Outside genes-ts, `@:jsx_inline_markup` remains a narrow opt-in, while
 *   `-D genes.react.inline_markup_all` keeps the old force-enable escape hatch.
 *
 * The explicit `genes.react.JSX.jsx("...")` string macro remains supported for
 * generated code, migration cases, and fragment roots that Haxe's XML-ish
 * inline-markup lexer cannot parse directly.
 *
 * LIMITATIONS
 * - Haxe 4 inline markup requires a named XML-like root tag, so React fragment
 *   roots (`<>...</>`) still need `jsx('<>...</>')` until the authoring syntax
 *   grows a dedicated fragment form.
 */
class InlineMarkup {
  public static function enable(): Void {
    if (Context.defined('genes.react.no_inline_markup'))
      return;
    Compiler.addGlobalMetadata('',
      '@:build(genes.react.InlineMarkup.build())', true, true, false);
  }

  public static macro function build(): Array<Field> {
    final fields = Context.getBuildFields();
    if (!shouldProcessLocalType())
      return fields;
    for (field in fields)
      rewriteField(field);
    return fields;
  }

  static function shouldProcessLocalType(): Bool {
    if (Context.defined('genes.react.no_inline_markup'))
      return false;

    if (Context.defined('genes.react.inline_markup_all'))
      return true;

    final local = Context.getLocalClass();
    if (local == null)
      return false;
    final cl = local.get();
    if (cl == null)
      return false;

    if (cl.meta != null
      && (cl.meta.has(':jsx_no_inline_markup') || cl.meta.has('jsx_no_inline_markup')))
      return false;

    if (Context.defined('genes.ts'))
      return true;

    if (cl.meta == null)
      return false;

    return cl.meta.has(':jsx_inline_markup') || cl.meta.has('jsx_inline_markup')
      || Context.defined('genes.react.inline_markup');
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
