package genes.ts;

#if macro
import haxe.macro.Context;
import haxe.macro.Type.AnonType;
import haxe.macro.Type.ClassField;

using StringTools;

/**
 * Precise TypeScript projections for intentionally untyped Haxe JS stdlib
 * storage.
 *
 * Why: the Haxe JS runtime crosses a few internal boundaries with `untyped`.
 * `haxe.Resource.content`, for example, is declared with a required `str`
 * member even though `__resources__()` legitimately produces base64 entries
 * where that property is absent. Printing the source declaration literally
 * makes correct embedded resources fail strict TypeScript compilation.
 *
 * What: this registry contains only evidence-backed stdlib type facts. It is
 * not a general escape hatch for user types and must never weaken a public
 * application surface.
 *
 * How: `TypeEmitter` asks whether an anonymous field is physically optional
 * before printing any occurrence of that type. Runtime behavior and classic JS
 * stay untouched; field declarations and compiler-generated loop locals then
 * share the same truthful TypeScript shape.
 */
class StdlibTypeOverrides {
  /**
   * Returns whether a Haxe-required anonymous field is optional at runtime.
   *
   * Haxe 4.3.7 declares resource entries as `{name, data, str}`, while its own
   * `__resources__()` bootstrap emits either `{name, data}` or `{name, str}`.
   * Match the declaration by source provenance plus its complete field set so
   * an unrelated user record with the same `str` member is never affected.
   */
  public static function isOptionalAnonymousField(anonymous:AnonType,
      field:ClassField):Bool {
    if (field.name != "str")
      return false;
    final source = Context.getPosInfos(field.pos).file.split("\\").join("/");
    if (!source.endsWith("/haxe/Resource.hx"))
      return false;
    final names = [for (candidate in anonymous.fields) candidate.name];
    names.sort(Reflect.compare);
    return names.join(",") == "data,name,str";
  }
}
#end
