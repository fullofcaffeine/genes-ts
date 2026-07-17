package literalevidence;

import haxe.DynamicAccess;

/**
 * Writes one line without giving the fixture a browser or Node-specific API.
 *
 * Why: the same Haxe source runs through standard Haxe JS, original Genes,
 * classic Genes, and genes-ts. Every JavaScript host in those lanes provides
 * `console.log`, but the fixture should not otherwise depend on a host library.
 *
 * What/How: `@:native("console")` binds this extern to the existing host
 * object. It creates no generated class, import, wrapper, or dynamic value.
 */
@:native("console")
extern class HostConsole {
  static function log(message:String):Void;
}

/**
 * Records exact runtime code units for compiler-emitted string literals.
 *
 * Why: visually identical Unicode output can still contain corrupted bytes,
 * split surrogate pairs, or a dropped control character. The downstream fork
 * changed the compiler-time string walk, so this fixture establishes behavior
 * before that mechanism is considered for adoption.
 *
 * What: the cases cover ASCII, quotes and slashes, newline/tab/carriage-return,
 * NUL and another control byte, Latin-1, BMP Unicode, an emoji surrogate pair,
 * a combining mark, U+2028/U+2029, a property key, and an import-like value.
 *
 * How: each value is converted to its JavaScript UTF-16 length and ordered
 * `charCodeAt` sequence. `@:genes.moduleDirective` additionally sends a
 * Unicode metadata literal through Genes' module-level printer. Standard Haxe
 * and original Genes safely ignore that Genes-specific metadata, so their
 * runtime transcript remains an independent oracle.
 */
@:genes.moduleDirective("unicode-é-😀")
class Main {
  static function main():Void {
    final cases = [
      {label: "ascii", value: "ASCII"},
      {
        label: "escapes",
        value: "quote:\" slash:\\ newline:\n carriage:\r tab:\t controls:\x00\x1F"
      },
      {label: "latin1", value: "latin:é"},
      {label: "bmp", value: "bmp:漢"},
      {label: "emoji", value: "emoji:😀"},
      {label: "combining", value: "combining:é"},
      {label: "separators", value: "separators:\u{2028}\u{2029}"},
      {label: "import-like", value: "./pkg/é😀.js"}
    ];

    final observations = [for (entry in cases)
      describe(entry.label, entry.value)];

    final propertyKey = "property-é😀";
    final properties = new DynamicAccess<String>();
    properties.set(propertyKey, "property-value-é😀");
    final propertyValue = properties.get(propertyKey);
    if (propertyValue == null)
      throw new haxe.Exception("Unicode property key was not retained");
    observations.push(describe("property-key", propertyKey));
    observations.push(describe("property-value", propertyValue));

    HostConsole.log(observations.join("|"));
  }

  static function describe(label:String, value:String):String {
    final codeUnits:Array<String> = [];
    for (index in 0...value.length)
      codeUnits.push(StringTools.hex(value.charCodeAt(index), 4));
    return '$label:${value.length}:${codeUnits.join(",")}';
  }
}
