package inc;

#if macro
import haxe.macro.Context;
import haxe.macro.Type;
import haxe.macro.TypedExprTools;

/**
 * An init macro that reads the program after typing, in every request
 * (genes-f8vc.9.27). For each static of `inc.Leaf2` named below it walks the
 * typed body of `inc.BodyMeta.value` and writes `@:ts.type("string")` on one
 * metadata holder that only that body declares or names:
 *
 * - `bodyConstraint`: the field `lv` of the structure in the constraint of
 *   the type parameter of the local function `inner` (S3 of the review of
 *   genes-ts #246);
 * - `bodyParam`: the type parameter of the local function `tagged`;
 * - `bodyLocalType`: the field `bv` of the structure in the declared type of
 *   the local `box`;
 * - `bodyArgType`: the field `av` of the structure in the type of the
 *   argument `arg` of the local function `wrap`.
 *
 * It does the same in class initializers (`__init__`; review of genes-ts
 * #258):
 *
 * - `bodyInitType`: the field `sv` of the structure in the declared type of
 *   the local `seen` of `inc.BodyInit`;
 * - `bodyInitConstraint`: the field `iv` of the structure in the constraint
 *   of the type parameter of the local function `ident` of
 *   `inc.BodyInitGeneric`.
 *
 * Haxe types none of these modules again, and the printer of each module
 * prints each holder.
 */
class BodyMetaMacro {
  public static function install(): Void {
    Context.onAfterTyping(types -> {
      final marks = new Map<String, Bool>();
      var body: Null<TypedExpr> = null;
      final inits: Array<TypedExpr> = [];
      for (type in types)
        switch type {
          case TClassDecl(ref):
            final cls = ref.get();
            if (cls.module == 'inc.Leaf2' && cls.name == 'Leaf2')
              for (field in cls.statics.get())
                marks.set(field.name, true);
            if (cls.module == 'inc.BodyMeta' && cls.name == 'BodyMeta')
              for (field in cls.statics.get())
                if (field.name == 'value')
                  body = field.expr();
            if ((cls.module == 'inc.BodyInit' && cls.name == 'BodyInit')
              || (cls.module == 'inc.BodyInitGeneric'
                && cls.name == 'BodyInitGeneric')) {
              final init = cls.init;
              if (init != null)
                inits.push(init);
            }
          default:
        }
      if (!marks.exists('bodyConstraint') && !marks.exists('bodyParam')
        && !marks.exists('bodyLocalType') && !marks.exists('bodyArgType')
        && !marks.exists('bodyInitType') && !marks.exists('bodyInitConstraint'))
        return;
      final pos = Context.currentPos();
      final expression = body;
      if (expression == null)
        Context.fatalError('BodyMetaMacro: no body of inc.BodyMeta.value', pos);
      if (inits.length == 0)
        Context.fatalError('BodyMetaMacro: no class initializer to mark', pos);
      function mark(type: Type, name: String): Void {
        switch type {
          case TAnonymous(anon):
            for (field in anon.get().fields)
              if (field.name == name) {
                field.meta.remove(':ts.type');
                field.meta.add(':ts.type', [macro "string"], pos);
              }
          case TAbstract(_, [inner]) | TType(_, [inner]):
            mark(inner, name);
          case TLazy(get):
            mark(get(), name);
          case TMono(ref) if (ref.get() != null):
            mark(ref.get(), name);
          default:
        }
      }
      function paramClass(variable: TVar): Null<ClassType> {
        final extra = variable.extra;
        if (extra == null || extra.params.length == 0)
          return null;
        return switch extra.params[0].t {
          case TInst(ref, _): ref.get();
          default: null;
        }
      }
      function markConstraint(variable: TVar, name: String): Void {
        final cls = paramClass(variable);
        if (cls != null)
          switch cls.kind {
            case KTypeParameter(constraints):
              for (item in constraints)
                mark(item, name);
            default:
          }
      }
      function walk(e: TypedExpr): Void {
        switch e.expr {
          case TVar(variable, _):
            if (variable.name == 'inner' && marks.exists('bodyConstraint'))
              markConstraint(variable, 'lv');
            if (variable.name == 'ident' && marks.exists('bodyInitConstraint'))
              markConstraint(variable, 'iv');
            if (variable.name == 'seen' && marks.exists('bodyInitType'))
              mark(variable.t, 'sv');
            if (variable.name == 'tagged' && marks.exists('bodyParam')) {
              final cls = paramClass(variable);
              if (cls != null) {
                cls.meta.remove(':ts.type');
                cls.meta.add(':ts.type', [macro "string"], pos);
              }
            }
            if (variable.name == 'box' && marks.exists('bodyLocalType'))
              mark(variable.t, 'bv');
          case TFunction(fn) if (marks.exists('bodyArgType')):
            for (argument in fn.args)
              if (argument.v.name == 'arg')
                mark(argument.v.t, 'av');
          default:
        }
        TypedExprTools.iter(e, walk);
      }
      walk(expression);
      for (init in inits)
        walk(init);
    });
  }
}
#end
