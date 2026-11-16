package genes.incremental;

#if macro
import haxe.macro.Expr.MetadataEntry;
import haxe.macro.ExprTools;
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
 *   `__init__` exists, the constructor with its metadata, and for each kept
 *   field its name, its full kind (read access, write access, method kind;
 *   dead-code elimination changes the access kind of a property when it
 *   removes an accessor), whether it is public, its metadata, and the
 *   metadata of each overload signature;
 * - an enum: the constructor names in order, each with its metadata;
 * - a typedef or abstract: the key;
 * - the metadata of the declaration.
 *
 * Metadata always means every entry with its arguments (`metaText`): a
 * sorted set of `@name(arguments)` texts, printed without positions, with
 * duplicates collapsed. Only `EXCLUDED_META` is left out.
 *
 * Why metadata with arguments (review of #244, round 2, N1): a macro of
 * another module can add metadata to a declaration that Haxe does not type
 * again. Example: an expression macro called from `inc.Leaf2` adds
 * `@:ts.returnType("string | null")` to `inc.MetaTarget.value`; the
 * TypeScript return type follows it. An init macro that reads the program
 * after typing can do the same in every request. Field metadata is read by
 * the emitters under many names (`:ts.*`, `:genes.*`, `:native`, `:keep`,
 * `:expose` and others), so the fingerprint holds all of it rather than a
 * hand-kept list that can miss a reader.
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
  /**
   * The metadata names that the fingerprint leaves out, each with the reason.
   * Each one changes between requests without a change of the module's
   * output on the TypeScript path, which is the only path of incremental
   * generation. `CleanRuleProbe` checks that no Genes source outside the
   * incremental owner reads one of them, except the readers that the
   * reason names.
   */
  public static final EXCLUDED_META: Map<String, String> = [
    ':genes.generate' => 'the request number of `Generator.use()` ' +
    '(`onGenerate`); read only by `Generator.needsGen`, which the classic ' +
    'profile uses and the TypeScript profile does not',
    GenerationChangeSet.EPOCH_META => 'the declaration stamp of ' +
      '`GenerationChangeSet`; the epochs compare it already',
    GenerationChangeSet.SAME_OBJECT_META =>
      'a token that the same-object test ' +
      'adds and removes within one call',
    ':used' =>
    'a mark of dead-code elimination; it changes when other modules ' +
    'change, and no Genes source reads it',
    ':directlyUsed' =>
    'a mark of dead-code elimination; it changes when other ' +
    'modules change, and no Genes source reads it',
    ':maybeUsed' => 'a mark of dead-code elimination; it changes when other ' +
    'modules change, and no Genes source reads it'
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
          final constructor = cls.constructor;
          if (constructor != null)
            buffer.add(' new' + metaText(constructor.get().meta));
          addMeta(buffer, cls.meta);
          for (field in cls.fields.get())
            addField(buffer, 'field', field);
          for (field in cls.statics.get())
            addField(buffer, 'static', field);
        case TEnum(ref, _):
          final enm = ref.get();
          buffer.add('enum ${TypeUtil.baseTypeFullName(enm)}');
          addMeta(buffer, enm.meta);
          for (name in enm.names) {
            final construct = enm.constructs.get(name);
            buffer.add('\n  constructor $name'
              + (construct == null ? '' : metaText(construct.meta)));
          }
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
    buffer.add(metaText(field.meta));
    for (signature in field.overloads.get())
      buffer.add(' overload' + metaText(signature.meta));
  }

  /**
   * Returns the fingerprint of a module whose declarations are all extern
   * classes: the key and the metadata of each class, without its fields.
   *
   * Why: such a module gets no output file, but other modules print what its
   * class metadata says (`@:jsRequire`, `@:native`), and a macro of another
   * module can change that without typing it again. Its fields are left out:
   * reading the field lists of the `js.*` externs was most of the cost of the
   * fingerprints, so a field metadata change of an extern is a limit.
   */
  public static function ofExtern(types: Array<Type>): String {
    final buffer = new StringBuf();
    for (type in types) {
      switch type {
        case TInst(ref, _):
          final cls = ref.get();
          buffer.add('extern ${TypeUtil.baseTypeFullName(cls)}');
          addMeta(buffer, cls.meta);
        default:
          buffer.add('other');
      }
      buffer.add('\n');
    }
    return buffer.toString();
  }

  static function addMeta(buffer: StringBuf, meta: MetaAccess): Void {
    buffer.add(metaText(meta));
  }

  /**
   * Returns the metadata of one declaration, field or enum constructor as
   * one text: ` @name(arguments)` for each entry that `EXCLUDED_META` does
   * not name, sorted, with duplicates collapsed. Empty without such entries.
   *
   * The arguments are printed by `ExprTools.toString`, which prints no
   * position. The set form keeps the text stable when Haxe adds an entry
   * twice or in another order between requests (for example `@:keep`).
   * Example: ` @:keep @:ts.returnType("string | null")`.
   */
  public static function metaText(meta: MetaAccess): String {
    final entries = new Map<String, Bool>();
    for (entry in meta.get())
      if (!EXCLUDED_META.exists(entry.name))
        entries.set(metaEntryText(entry), true);
    final texts = [for (text in entries.keys()) text];
    if (texts.length == 0)
      return '';
    texts.sort((left, right) -> left < right ? -1 : left > right ? 1 : 0);
    return ' ' + texts.join(' ');
  }

  static function metaEntryText(entry: MetadataEntry): String {
    final params = entry.params;
    if (params == null || params.length == 0)
      return '@${entry.name}';
    return
      '@${entry.name}(${[for (param in params) ExprTools.toString(param)].join(', ')})';
  }
}
#end
