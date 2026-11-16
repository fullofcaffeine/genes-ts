package inc;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
#end

class Macros {
  /** Returns the number of statics of `inc.Loaded` as a constant string. */
  public static macro function loadedName(): Expr {
    final count = switch Context.getType("inc.Loaded") {
      case TInst(owner, _): owner.get().statics.get().length;
      default: 0;
    }
    return macro $v{"loaded:" + count};
  }

  #if macro
  /** Adds `kind`: the number of statics of `inc.Loaded2`. */
  public static function build(): Array<Field> {
    final fields = Context.getBuildFields();
    final count = switch Context.getType("inc.Loaded2") {
      case TInst(owner, _): owner.get().statics.get().length;
      default: 0;
    }
    fields.push({
      name: "kind",
      access: [APublic, AStatic, AFinal],
      kind: FVar(macro : Int, macro $v{count}),
      pos: Context.currentPos()
    });
    return fields;
  }
  #end
}
