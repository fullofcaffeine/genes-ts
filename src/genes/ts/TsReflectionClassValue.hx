package genes.ts;

import genes.EmittedMemberName;
import genes.util.TypeUtil;
import haxe.macro.Context;
import haxe.macro.Type;

/**
 * Proves when a generated class constructor needs an identity bridge to
 * TypeScript's structural `Function` interface at Haxe reflection boundaries.
 *
 * Why
 * ----
 * JavaScript implements every emitted class constructor as a Function object.
 * Haxe may also declare an unrelated static method whose emitted name belongs
 * to JavaScript's `Function` surface:
 *
 * ```haxe
 * class Calculator {
 *   public static function apply(a:Int, b:Int, c:Int):Int {
 *     return a + b + c;
 *   }
 * }
 * ```
 *
 * TypeScript compares properties structurally. It therefore compares that
 * three-argument Haxe method with `Function.apply(thisArg, args?)` and rejects
 * `typeof Calculator` as `Function`, even though the runtime class constructor
 * is still a genuine Function object.
 *
 * What
 * ----
 * This relation recognizes the two reviewed incompatibilities exposed by real
 * Haxe libraries:
 *
 * - `toString` cannot require arguments and must return the core Haxe `String`
 *   projection expected by JavaScript's zero-argument method;
 * - `Function.apply` declares two positional parameters (`thisArg` and the
 *   optional `argArray`), so the class `apply` cannot require a third.
 *
 * A function-valued `call` or `bind` remains compatible because TypeScript's
 * declarations expose rest arguments for those methods. A non-function field
 * with one of these callable names is incompatible. Every emitted
 * `@:overload` signature participates in the same structural class type.
 *
 * The check follows the superclass chain because JavaScript and TypeScript
 * class values inherit static members. An emitted child property hides its
 * same-named parent property, so only the effective inherited surface is
 * compared.
 *
 * How
 * ---
 * The TypeScript emitter consults this typed, output-name-aware proof only
 * while emitting `__interfaces__`, `__super__`, `__class__`, or runtime class
 * registration. It then emits `Register.unsafeCast<Function>(ClassValue)`, a
 * runtime identity operation. Ordinary construction, static calls, imports,
 * declarations, and classic JavaScript never consume this proof.
 *
 * This is deliberately not a general TypeScript assignability engine. Unknown
 * or future Function-member collisions stay visible to strict TypeScript until
 * they receive their own typed evidence and positive/negative fixtures.
 */
class TsReflectionClassValue {
  public static function needsFunctionBridge(owner: ClassType): Bool {
    return classOrParentConflicts(owner, new Map(), 0);
  }

  static function classOrParentConflicts(owner: ClassType,
      hiddenByChild: Map<String, Bool>, depth: Int): Bool {
    // Haxe rejects cyclic class inheritance. If an unexpectedly deep compiler
    // structure reaches this guard, the safe reflection-boundary fallback is
    // still to preserve the JavaScript runtime fact that the class is a
    // Function. Returning true avoids silently overlooking a parent conflict.
    if (depth > 128)
      return true;

    final declaredHere = new Map<String, Bool>();
    for (field in owner.statics.get()) {
      final emittedName = EmittedMemberName.classStaticField(owner, field);
      if (hiddenByChild.exists(emittedName))
        continue;
      if (fieldConflicts(emittedName, field))
        return true;
      declaredHere.set(emittedName, true);
    }

    return switch owner.superClass {
      case null:
        false;
      case {t: parent}:
        for (name in declaredHere.keys())
          hiddenByChild.set(name, true);
        classOrParentConflicts(parent.get(), hiddenByChild, depth + 1);
    }
  }

  static function fieldConflicts(emittedName: String, field: ClassField): Bool {
    if (signatureConflicts(emittedName, field.type))
      return true;
    for (signature in field.overloads.get())
      if (signatureConflicts(emittedName, signature.type))
        return true;
    return false;
  }

  static function signatureConflicts(emittedName: String, type: Type): Bool {
    return switch Context.follow(type) {
      case TFun(arguments, result):
        switch emittedName {
          case 'toString': requiredArity(arguments) > 0 || !isCoreString(result);
          case 'apply':
            requiredArity(arguments) > 2;
          case 'call' | 'bind':
            false;
          default:
            false;
        }
      default:
        switch emittedName {
          case 'toString' | 'apply' | 'call' | 'bind':
            true;
          default:
            false;
        }
    }
  }

  /**
   * Returns the minimum positional arity emitted by TypeScript.
   *
   * A Haxe optional argument before a later required positional argument
   * cannot use `?` syntax in TypeScript, so every position through that final
   * argument remains part of the callable's minimum arity. A rest parameter
   * accepts zero values and does not increase that arity.
   */
  static function requiredArity(arguments: Array<{
    name: String,
    opt: Bool,
    t: Type
  }>): Int {
    return TypeUtil.lastRequiredParameterIndex(arguments) + 1;
  }

  static function isCoreString(type: Type): Bool {
    return switch Context.follow(type) {
      case TInst(reference, _): final value = reference.get(); value.pack.length == 0 && value.module == 'String' && value.name == 'String';
      case TDynamic(_):
        true;
      default:
        false;
    }
  }
}
