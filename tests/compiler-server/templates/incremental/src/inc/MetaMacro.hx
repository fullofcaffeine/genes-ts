package inc;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
#end

/**
 * An expression macro that, while Haxe types its caller, adds
 * `@:ts.returnType` to the field `value` of `inc.MetaTarget`, a module that
 * Haxe does not type again.
 */
class MetaMacro {
  public static macro function mark(tag: String): Expr {
    switch Context.getType("inc.MetaTarget") {
      case TInst(owner, _):
        for (field in owner.get().statics.get())
          if (field.name == "value") {
            field.meta.remove(":ts.returnType");
            field.meta.add(":ts.returnType", [macro $v{tag}],
              Context.currentPos());
          }
      default:
    }
    return macro $v{tag};
  }
}
