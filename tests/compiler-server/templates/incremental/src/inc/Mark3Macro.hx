package inc;

#if macro
import haxe.macro.Context;
import haxe.macro.Type;

/**
 * An init macro that reads the program after typing, in every request
 * (genes-f8vc.9.26, from the review of genes-ts #245). Like
 * `inc.Mark2Macro`, for each static of `inc.Leaf2` named below it writes
 * `@:ts.type("string")` on a field of an anonymous structure of another
 * module that Haxe does not type again:
 *
 * - L5, a structure in a type-parameter constraint of `inc.Constrained`:
 *   `markConstraint` (field `v`, method `pick`), `markRank` (field `r`,
 *   method `rank`, whose constraint names its own parameter),
 *   `markBoxConstraint` (field `c`, class `ConstrainedBox`),
 *   `markDefConstraint` (field `d`, typedef `ConstrainedDef`),
 *   `markAbsConstraint` (field `a`, abstract `ConstrainedAbs`) and
 *   `markEnumConstraint` (field `e`, constructor `ConstrainedEnum.Hold`);
 * - L6, a declaration that the generator adds late in `inc.LateEnum`:
 *   `markLateEnum` (field `q` of the constructor `Item`) and `markLateBox`
 *   (field `lb` in the constraint of the class `LateBox`).
 *
 * Round 2 of the review of genes-ts #246 adds metadata on a type parameter
 * itself and on a late declaration: `markTpMeta`, `markBoxTpMeta` and
 * `markLateTpMeta` write `@:ts.type("string")` on the type parameter `T` of
 * `inc.Constrained.tag`, of the class `ConstrainedBox` and of the late class
 * `LateBox`; `markLateClassMeta` writes it on the late class `LateBox`.
 *
 * `markListedClassMeta` writes it on the listed class
 * `inc.ListedTs.ListedBox`, which the clean module `inc.ListedUser` names
 * only in a type position.
 */
class Mark3Macro {
  public static function install(): Void {
    Context.onAfterTyping(types -> {
      final marks = new Map<String, Bool>();
      final constraints = new Map<String, Array<Type>>();
      final ownParams = new Map<String, ClassType>();
      var late: Null<Type> = null;
      var lateBox: Null<ClassType> = null;
      var listedBox: Null<ClassType> = null;
      function keep(name: String, params: Array<TypeParameter>): Void {
        final found = [];
        for (param in params)
          switch param.t {
            case TInst(owner, _):
              switch owner.get().kind {
                case KTypeParameter(list):
                  for (item in list)
                    found.push(item);
                default:
              }
            default:
          }
        constraints.set(name, found);
        if (params.length > 0)
          switch params[0].t {
            case TInst(owner, _):
              ownParams.set(name, owner.get());
            default:
          }
      }
      for (type in types)
        switch type {
          case TClassDecl(ref):
            final cls = ref.get();
            if (cls.module == 'inc.Leaf2' && cls.name == 'Leaf2')
              for (field in cls.statics.get())
                marks.set(field.name, true);
            if (cls.module == 'inc.Constrained' && cls.name == 'Constrained')
              for (field in cls.statics.get())
                keep(field.name, field.params);
            if (cls.module == 'inc.Constrained' && cls.name == 'ConstrainedBox')
              keep('box', cls.params);
            if (cls.module == 'inc.ListedTs' && cls.name == 'ListedBox')
              listedBox = cls;
            if (cls.module == 'inc.LateEnum' && cls.name == 'LateBox') {
              keep('lateBox', cls.params);
              lateBox = cls;
            }
          case TTypeDecl(ref):
            final def = ref.get();
            if (def.module == 'inc.Constrained' && def.name == 'ConstrainedDef')
              keep('def', def.params);
          case TAbstract(ref):
            final abs = ref.get();
            if (abs.module == 'inc.Constrained' && abs.name == 'ConstrainedAbs')
              keep('abs', abs.params);
          case TEnumDecl(ref):
            final enm = ref.get();
            if (enm.module == 'inc.Constrained'
              && enm.name == 'ConstrainedEnum') {
              final hold = enm.constructs.get('Hold');
              if (hold != null)
                keep('hold', hold.params);
            }
            if (enm.module == 'inc.LateEnum' && enm.name == 'LateEnum') {
              final item = enm.constructs.get('Item');
              if (item != null)
                late = item.type;
            }
          default:
        }
      final pos = Context.currentPos();
      function mark(type: Null<Type>, name: String): Void {
        switch type {
          case TAnonymous(anon):
            for (field in anon.get().fields)
              if (field.name == name) {
                field.meta.remove(':ts.type');
                field.meta.add(':ts.type', [macro "string"], pos);
              }
          case TFun(args, result):
            for (arg in args)
              mark(arg.t, name);
            mark(result, name);
          case TLazy(get):
            mark(get(), name);
          default:
        }
      }
      function markConstraint(key: String, name: String): Void {
        final list = constraints.get(key);
        if (list != null)
          for (type in list)
            mark(type, name);
      }
      if (marks.exists('markConstraint'))
        markConstraint('pick', 'v');
      if (marks.exists('markRank'))
        markConstraint('rank', 'r');
      if (marks.exists('markBoxConstraint'))
        markConstraint('box', 'c');
      if (marks.exists('markDefConstraint'))
        markConstraint('def', 'd');
      if (marks.exists('markAbsConstraint'))
        markConstraint('abs', 'a');
      if (marks.exists('markEnumConstraint'))
        markConstraint('hold', 'e');
      if (marks.exists('markLateEnum'))
        mark(late, 'q');
      if (marks.exists('markLateBox'))
        markConstraint('lateBox', 'lb');
      function markOwn(meta: MetaAccess): Void {
        meta.remove(':ts.type');
        meta.add(':ts.type', [macro "string"], pos);
      }
      function markParam(key: String): Void {
        final param = ownParams.get(key);
        if (param != null)
          markOwn(param.meta);
      }
      if (marks.exists('markTpMeta'))
        markParam('tag');
      if (marks.exists('markBoxTpMeta'))
        markParam('box');
      if (marks.exists('markLateTpMeta'))
        markParam('lateBox');
      final box = lateBox;
      if (marks.exists('markLateClassMeta') && box != null)
        markOwn(box.meta);
      final listed = listedBox;
      if (marks.exists('markListedClassMeta') && listed != null)
        markOwn(listed.meta);
    });
  }
}
#end
