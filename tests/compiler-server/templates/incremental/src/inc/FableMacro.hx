package inc;

#if macro
import haxe.macro.Context;
import haxe.macro.Type;

/**
 * An init macro that reads the program after typing, in every request
 * (genes-f8vc.9.26, M3 of the cross-model review of genes-ts #246). For each
 * static of `inc.Leaf2` named below it writes `@:ts.type("string")` on a
 * part of `inc.FableProbe` that a structure field declares:
 *
 * - `fableAnonTp`: the type parameter `T` of the field `pick` of the
 *   typedef `FableApi`;
 * - `fableInlineTp`: the type parameter `U` of the field `sel` of the
 *   structure in the argument of `FableProbe.call`;
 * - `fableWideConstraint`: the field `w` of the structure in the constraint
 *   of the type parameter `W` of the field `sel` in `FableProbe.wide`.
 */
class FableMacro {
  public static function install(): Void {
    Context.onAfterTyping(types -> {
      final marks = new Map<String, Bool>();
      var typedefParam: Null<ClassType> = null;
      var inlineParam: Null<ClassType> = null;
      var wideParam: Null<ClassType> = null;
      function paramOf(type: Null<Type>, name: String): Null<ClassType> {
        return switch type {
          case TAnonymous(anon):
            var found: Null<ClassType> = null;
            for (field in anon.get().fields)
              if (field.name == name && field.params.length > 0)
                switch field.params[0].t {
                  case TInst(owner, _): found = owner.get();
                  default:
                }
            found;
          case TLazy(get): paramOf(get(), name);
          default: null;
        }
      }
      for (type in types)
        switch type {
          case TClassDecl(ref):
            final cls = ref.get();
            if (cls.module == 'inc.Leaf2' && cls.name == 'Leaf2')
              for (field in cls.statics.get())
                marks.set(field.name, true);
            if (cls.module == 'inc.FableProbe' && cls.name == 'FableProbe')
              for (field in cls.statics.get())
              if (field.name == 'call')
                switch field.type {
                  case TFun(args, _): inlineParam = paramOf(args[0].t, 'sel');
                  default:
                }
              else if (field.name == 'wide')
                switch field.type {
                  case TFun(args, _): wideParam = paramOf(args[0].t, 'sel');
                  default:
                }
          case TTypeDecl(ref):
            final def = ref.get();
            if (def.module == 'inc.FableProbe' && def.name == 'FableApi')
              typedefParam = paramOf(def.type, 'pick');
          default:
        }
      final pos = Context.currentPos();
      function markOwn(param: Null<ClassType>, label: String): Void {
        if (param == null)
          Context.fatalError('FableMacro: no type parameter for $label', pos);
        param.meta.remove(':ts.type');
        param.meta.add(':ts.type', [macro "string"], pos);
      }
      if (marks.exists('fableAnonTp'))
        markOwn(typedefParam, 'FableApi.pick');
      if (marks.exists('fableInlineTp'))
        markOwn(inlineParam, 'FableProbe.call');
      if (marks.exists('fableWideConstraint')) {
        final param = wideParam;
        if (param == null)
          Context.fatalError('FableMacro: no type parameter for FableProbe.wide',
            pos);
        var done = false;
        switch param.kind {
          case KTypeParameter(constraints):
            for (constraint in constraints)
              switch constraint {
                case TAnonymous(anon):
                  for (field in anon.get().fields)
                    if (field.name == 'w') {
                      field.meta.remove(':ts.type');
                      field.meta.add(':ts.type', [macro "string"], pos);
                      done = true;
                    }
                default:
              }
          default:
        }
        if (!done)
          Context.fatalError('FableMacro: no constraint field w', pos);
      }
    });
  }
}
#end
