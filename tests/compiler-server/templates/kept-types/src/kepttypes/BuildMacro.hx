package kepttypes;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
#end

/**
 * Adds two static fields to `MacroBuilt`.
 *
 * `shape` has the type that `shape.txt` names: `Int`, or `String` when the
 * file says `text`. The macro tells Haxe that the module depends on that
 * file. `seedCopy` has the type of `MacroDep.seed`; the lookup by name makes
 * Haxe record that dependency itself.
 */
class BuildMacro {
  #if macro
  public static function build(): Array<Field> {
    final fields = Context.getBuildFields();
    final pos = Context.currentPos();
    final file = Context.resolvePath('kepttypes/shape.txt');
    Context.registerModuleDependency(Context.getLocalModule(), file);
    final isText = StringTools.trim(sys.io.File.getContent(file)) == 'text';
    fields.push({
      name: 'shape',
      access: [APublic, AStatic],
      kind: FVar(isText ? macro : String : macro : Int,
        isText ? macro "shape" : macro 7),
      pos: pos
    });
    var seedType: Null<haxe.macro.Type> = null;
    switch Context.getType('kepttypes.MacroDep') {
      case TInst(_.get() => dependency, _):
        for (field in dependency.statics.get())
          if (field.name == 'seed')
            seedType = field.type;
      default:
    }
    if (seedType == null)
      Context.error('kepttypes.MacroDep.seed is missing', pos);
    fields.push({
      name: 'seedCopy',
      access: [APublic, AStatic],
      kind: FVar(Context.toComplexType(seedType), null),
      pos: pos
    });
    return fields;
  }
  #end
}
