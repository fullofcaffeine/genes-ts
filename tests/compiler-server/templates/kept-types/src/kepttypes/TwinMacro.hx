package kepttypes;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;
#end

/**
 * Defines the class `kepttypes.Twin` each time Haxe types `Twinner`, and
 * gives the new class the private stamp metadata that its own earlier
 * object carried.
 *
 * Why: this is the one case that the text conditions of the keep rule
 * cannot reject. The new `Twin` is another compiler object, but its stamp
 * names it, the stamp equals the stamp of the kept bucket, and the member
 * list is equal. Only the same-object test sees the difference. A macro can
 * do this when it keeps metadata of its result between requests; this one
 * keeps the entries whose name starts with `:genes.`.
 *
 * The type of the field `state` comes from the `@:twin` metadata of
 * `Twinner`: `phase` gives `kepttypes.Phase`, any other text gives
 * `String`. So a bucket of the earlier `Twin` holds a wrong field type.
 */
class TwinMacro {
  #if macro
  @:persistent static var saved: Metadata = [];

  public static function build(): Array<Field> {
    final local = Context.getLocalClass();
    final kind = local == null ? 'text' : switch local.get()
      .meta.extract(':twin') {
      case [{params: [{expr: EConst(CString(value, _))}]}]: value;
      default: 'text';
    }
    final pos = Context.currentPos();
    final stateType: ComplexType = kind == 'phase' ? macro : kepttypes.Phase : macro : String;
    final initial: Expr = kind == 'phase' ? macro kepttypes.Phase.Draft : macro "draft";
    Context.defineType({
      pack: ['kepttypes'],
      name: 'Twin',
      pos: pos,
      meta: [{name: ':keep', pos: pos}].concat(saved),
      kind: TDClass(),
      fields: [
        {
          name: 'state',
          access: [APublic, AStatic],
          kind: FVar(stateType, initial),
          pos: pos
        }
      ]
    });
    // After the after-typing callbacks, the new class carries its stamp.
    Context.onGenerate(types -> {
      for (type in types)
        switch type {
          case TInst(_.get() => {pack: ['kepttypes'], name: 'Twin',
            meta: meta}, _):
            saved = [
              for (entry in meta.get())
                if (StringTools.startsWith(entry.name,
                  ':genes.typedEpoch')) entry
            ];
          default:
        }
    });
    return null;
  }
  #end
}
