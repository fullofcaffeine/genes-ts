package genes.ts;

#if macro
import haxe.macro.Context;
import haxe.macro.Type.AnonType;
import haxe.macro.Type.ClassField;
import haxe.macro.Type.FieldAccess;
import haxe.macro.Type.Type;

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

  /**
   * Identifies the typed-array `buffer` read that needs an explicit TS type.
   *
   * Why: Haxe 4.3.7's JS externs promise that `js.lib.*Array.buffer` is an
   * `ArrayBuffer`. TypeScript 6 and 7 model unparameterized typed arrays with
   * an `ArrayBufferLike` buffer so they can also describe shared buffers. A
   * Haxe local annotation can therefore widen a freshly allocated typed array
   * and make a subsequent, semantically valid `Bytes` constructor call fail.
   *
   * What/How: recognize only a `buffer` instance field owned by the Haxe
   * `js.lib` extern package whose typed Haxe result is `js.lib.ArrayBuffer`.
   * The TS emitter then prints a local `as ArrayBuffer` assertion. That syntax
   * works with both the older non-generic TS5 libs and the newer generic libs;
   * classic JavaScript output and runtime behavior are untouched.
   */
  public static function needsArrayBufferAssertion(resultType:Type,
      field:FieldAccess):Bool {
    final isStdlibBuffer = switch field {
      case FInstance(owner, _, fieldRef):
        final ownerType = owner.get();
        final classField = fieldRef.get();
        // Haxe's generated module path is the reliable provenance here. Some
        // JS extern classes report an empty `pack` through the typed macro API.
        ownerType.module.startsWith("js.lib.") && classField.name == "buffer";
      default:
        false;
    };
    if (!isStdlibBuffer)
      return false;

    return switch Context.follow(resultType) {
      case TInst(typeRef, _):
        final type = typeRef.get();
        type.module == "js.lib.ArrayBuffer" && type.name == "ArrayBuffer";
      default:
        false;
    };
  }
}
#end
