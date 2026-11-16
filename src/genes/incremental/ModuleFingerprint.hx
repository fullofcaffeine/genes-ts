package genes.incremental;

#if macro
import haxe.macro.Type;
import genes.util.TypeUtil;

/**
 * Builds the shallow fingerprint of one module: the facts that can change
 * the module's output although Haxe did not type the module again.
 *
 * Why: dead-code elimination is a whole-program step. When an edit in module
 * `A` starts to use `B.helper`, the field survives and `B`'s output changes,
 * but Haxe did not type `B` again, so its epochs are equal. The fingerprint
 * sees such a change.
 *
 * What, for each declaration of the module in the generator's list (after
 * dead-code elimination), in that order:
 *
 * - the declaration key;
 * - a class: parent class and interface names, `extern`, `interface`, whether
 *   `__init__` and a constructor exist, and for each kept field its name, its
 *   full kind (read access, write access, method kind; dead-code elimination
 *   changes the access kind of a property when it removes an accessor) and
 *   whether it is public;
 * - an enum: the constructor names in order;
 * - a typedef or abstract: the key only;
 * - the metadata names of the declaration, without the Genes stamps and
 *   without the marks that dead-code elimination adds (`:used`,
 *   `:directlyUsed`, `:maybeUsed`), which change when other modules change.
 *
 * The caller adds the module directives and the module's part of the
 * `@:expose` list.
 *
 * Not in the fingerprint: field types, bodies and positions. They change only
 * when Haxe types the module again, and the epochs guard that. Whether a
 * field has a body is also left out: reading it copies the complete typed
 * body in the macro interpreter, and only a new typing changes it.
 */
class ModuleFingerprint {
  static final IGNORED_META = [
    ':genes.generate' => true,
    GenerationChangeSet.EPOCH_META => true,
    ':used' => true,
    ':directlyUsed' => true,
    ':maybeUsed' => true
  ];

  /** Returns the fingerprint text of one module's declarations. */
  public static function of(types: Array<Type>, directives: Array<String>,
      exposed: Array<String>): String {
    final buffer = new StringBuf();
    for (type in types) {
      switch type {
        case TInst(ref, _):
          final cls = ref.get();
          buffer.add('class ${TypeUtil.baseTypeFullName(cls)}');
          final parent = cls.superClass;
          if (parent != null)
            buffer.add(' extends ${TypeUtil.baseTypeFullName(parent.t.get())}');
          for (item in cls.interfaces)
            buffer.add(' implements ${TypeUtil.baseTypeFullName(item.t.get())}');
          buffer.add(cls.isExtern ? ' extern' : '');
          buffer.add(cls.isInterface ? ' interface' : '');
          buffer.add(cls.init != null ? ' init' : '');
          buffer.add(cls.constructor != null ? ' new' : '');
          addMeta(buffer, cls.meta);
          for (field in cls.fields.get())
            addField(buffer, 'field', field);
          for (field in cls.statics.get())
            addField(buffer, 'static', field);
        case TEnum(ref, _):
          final enm = ref.get();
          buffer.add('enum ${TypeUtil.baseTypeFullName(enm)} ${enm.names.join(',')}');
          addMeta(buffer, enm.meta);
        case TType(ref, _):
          final def = ref.get();
          buffer.add('typedef ${TypeUtil.baseTypeFullName(def)}');
          addMeta(buffer, def.meta);
        case TAbstract(ref, _):
          final abs = ref.get();
          buffer.add('abstract ${TypeUtil.baseTypeFullName(abs)}');
          addMeta(buffer, abs.meta);
        default:
          buffer.add('other');
      }
      buffer.add('\n');
    }
    buffer.add('directives ${directives.join('\x01')}\n');
    buffer.add('expose ${exposed.join(',')}\n');
    return buffer.toString();
  }

  /**
   * Returns the final member list of one module after the walk of
   * reachability, as one text: one line for each member, in order.
   *
   * Why: the walk can add a declaration to a module because another module
   * refers to it (`Module.addTypes`), and the order of such additions is part
   * of the output. A typedef member also depends on the set of concrete type
   * names of the whole program. The fingerprint reads only the generator's
   * list, so a replay compares this text too, before any module is printed.
   *
   * What: the kind and full name of each member, the number of its type
   * arguments, and for a class each emitted field in order with its static
   * flag and whether it keeps a native getter or setter (dead-code
   * elimination can remove an accessor). Example line:
   * `class inc.Box 0 s:make i:item`.
   */
  public static function members(members: Array<genes.Module.Member>): String {
    final buffer = new StringBuf();
    for (member in members) {
      switch member {
        case MClass(type, params, fields):
          buffer.add('class ${TypeUtil.baseTypeFullName(type)} ${params.length}');
          for (field in fields)
            buffer.add(' ${field.isStatic ? 's' : 'i'}:${field.name}'
              + (field.getter ? '+get' : '')
              + (field.setter ? '+set' : ''));
        case MEnum(type, params):
          buffer.add('enum ${TypeUtil.baseTypeFullName(type)} ${params.length}');
        case MType(type, params):
          buffer.add('typedef ${TypeUtil.baseTypeFullName(type)} ${params.length}');
        case MMain(_):
          buffer.add('main');
      }
      buffer.add('\n');
    }
    return buffer.toString();
  }

  static function addField(buffer: StringBuf, label: String,
      field: ClassField): Void {
    buffer.add('\n  $label ${field.name} ');
    // The enum value text holds the complete kind: `FVar(AccNormal, AccNo)`
    // or `FMethod(MethInline)`. It is deterministic for these constructors.
    buffer.add(Std.string(field.kind));
    buffer.add(field.isPublic ? ' public' : '');
  }

  static function addMeta(buffer: StringBuf, meta: MetaAccess): Void {
    final names = [];
    for (entry in meta.get())
      if (!IGNORED_META.exists(entry.name))
        names.push(entry.name);
    if (names.length > 0)
      buffer.add(' @' + names.join(' @'));
  }
}
#end
