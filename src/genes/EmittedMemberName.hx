package genes;

import haxe.macro.Type.ClassType;
import genes.Module.Field;
import genes.util.TypeUtil;

/**
 * Resolves observable class-member spellings before target printing.
 *
 * Why: module-function validation, the descriptor seed, its direct assignment,
 * and ordinary class emission must agree on the same property key. Recomputing
 * `@:native` and Haxe's generated `name`/`length` escape in each printer could
 * validate one property and install another.
 *
 * What/How: this is the existing Genes static-member rule expressed once as a
 * target-neutral semantic fact. It does not sanitize or make a requested name
 * unique; callers either print the returned member syntax or reject a shape
 * their output contract cannot represent.
 */
class EmittedMemberName {
  public static function staticField(owner: ClassType, field: Field): String {
    final nativeName = TypeUtil.nativeName(field.meta);
    if (nativeName != null)
      return nativeName;
    return switch [owner.isExtern, field.name] {
      case [false, name = 'name' | 'length']: '$' + name;
      default: field.name;
    };
  }
}
