package template_literals;

import genes.TemplateLiteral;

/**
 * Exact dynamic-path boundary used to prove contextual TypeScript inference.
 *
 * Without the override Haxe can model only `String`; genes-ts substitutes the
 * canonical `` `/records/${string}` `` type while the abstract still erases to
 * an ordinary string in classic JS. The fixture deliberately keeps this host
 * type at the boundary rather than teaching the compiler anything about paths.
 */
@:ts.type("`/records/$${string}`")
abstract RecordHref(String) from String to String {}

/** Exact static-path control; both output profiles retain the same JS value. */
@:ts.type("\"/about\"")
abstract AboutHref(String) from String to String {}

/**
 * Same-source runtime and output evidence for typed string templates.
 *
 * `@:keep` exposes source assertions which Haxe application DCE would otherwise
 * remove. The methods remain ordinary static members; the annotation changes
 * reachability only and introduces no runtime behavior.
 */
class Main {
  static var events: Array<String> = [];

  @:keep
  public static function href(id: String): RecordHref {
    return TemplateLiteral.value('/records/${StringTools.urlEncode(id)}');
  }

  @:keep
  public static function staticHref(): AboutHref {
    return TemplateLiteral.value('/about');
  }

  @:keep
  public static function ordinaryInterpolation(id: String): String {
    return '/records/${StringTools.urlEncode(id)}';
  }

  @:keep
  public static function pureInterpolation(value: String): String {
    return TemplateLiteral.value('${value}');
  }

  static function observe(label: String): String {
    events.push(label);
    return label.toUpperCase();
  }

  static function escapedAndOrdered(): String {
    events = [];
    return TemplateLiteral.value('tick`|slash\\|literal $${brace}|line
${observe("first")}|${observe("second")}');
  }

  /**
   * Prints one deterministic report without adding a console wrapper API.
   *
   * `js.Syntax.code` is confined to this fixture statement because Haxe has no
   * target-neutral Node console value. Its sole argument is already serialized
   * `String`; it neither participates in the template feature nor creates a
   * typed value consumed by application code.
   */
  public static function main(): Void {
    final escaped = escapedAndOrdered();
    final report = {
      href: href('a b/c'),
      staticHref: staticHref(),
      pureInterpolation: pureInterpolation('whole'),
      escaped: escaped,
      events: events.copy()
    };
    js.Syntax.code('console.log({0})', haxe.Json.stringify(report));
  }
}
