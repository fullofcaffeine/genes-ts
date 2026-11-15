package kepttypes;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
#end

/**
 * Defines the class `kepttypes.Clone` with a copy of the class metadata of
 * `GenericOwner`.
 *
 * A macro that derives one type from another often copies metadata this way.
 * The copy includes private metadata that another macro added, so the new
 * type carries a stamp that was made for `GenericOwner`.
 */
class CloneMacro {
  #if macro
  public static function build(): Array<Field> {
    final owner = switch Context.getType('kepttypes.GenericOwner') {
      case TInst(reference, _): reference.get();
      default: Context.error('kepttypes.GenericOwner is not a class',
          Context.currentPos());
    }
    Context.defineType({
      pack: ['kepttypes'],
      name: 'Clone',
      pos: Context.currentPos(),
      meta: owner.meta.get(),
      kind: TDClass(),
      fields: []
    });
    return null;
  }
  #end
}
