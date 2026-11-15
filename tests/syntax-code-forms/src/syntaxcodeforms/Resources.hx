package syntaxcodeforms;

/**
 * Reads the resources that the build embedded with `-resource file@name`.
 *
 * Why: `haxe.Resource` gets its table from the compiler intrinsic
 * `__resources__()`. The harness builds this fixture with zero, one, and
 * three resources and compares the emitted `haxe.Resource` module.
 */
class Resources {
  public static function run(): Array<String> {
    final names = haxe.Resource.listNames();
    names.sort(Reflect.compare);
    return [
      for (name in names)
        name + "=" + StringTools.trim(haxe.Resource.getString(name))
    ];
  }
}
