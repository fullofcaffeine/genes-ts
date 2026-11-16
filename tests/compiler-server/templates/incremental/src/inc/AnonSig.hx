package inc;

/**
 * Anonymous structures in the types of class fields (genes-f8vc.9.24).
 *
 * `inc.Mark2Macro` writes `@:ts.type("string")` on a field of one of these
 * structures from another module, after typing. Haxe does not type this
 * module again, so only the fingerprint of this module shows the change.
 * Each structure is in another place of a field type: the type of a
 * variable, a function argument, a function result, and a type argument.
 */
class AnonSig {
  public static var point: {x: Int} = {x: 1};
  public static var rows: Array<{w: Int}> = [{w: 4}];

  public static function take(p: {y: Int}): Int {
    return p.y;
  }

  public static function make(): {z: Int} {
    return {z: 3};
  }

  public static function value(): String {
    return Std.string(point.x + take({y: 2}) + make().z + rows[0].w);
  }
}
