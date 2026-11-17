package genes.incremental;

#if macro
import haxe.macro.Context;
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
 * - the metadata of the declaration;
 * - the field metadata of each anonymous structure that the declaration
 *   writes inline: in a typedef body, the type behind an abstract, or the
 *   type of a field, constructor, overload signature or enum constructor,
 *   and in the type arguments of a parent class or interface
 *   (`anonymousText`);
 * - the metadata of each type parameter and the same structure metadata
 *   for each structure in its constraints, where a class, field,
 *   constructor, overload signature, typedef, abstract, enum, enum
 *   constructor or field of an anonymous structure declares type
 *   parameters (`constraintText`). A type parameter that only a typed body
 *   declares, such as one of a local function, is not covered (limit S3 of
 *   the review of genes-ts #246).
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
 * A module of extern classes only gets `ofExtern`, a shorter text with the
 * same metadata.
 *
 * Every other declaration of every module that Haxe typed, such as a class
 * or enum that dead-code elimination removed, gets the same text through
 * `unlisted`, as one digest for each module (genes-f8vc.9.27). A printer
 * can read such a declaration without adding it as a member, for example
 * the `@:ts.type` of a removed class at a use site
 * (`TypeReferenceCollector`): limit M2a of the review of genes-ts #246. So
 * each piece of metadata that a printer can reach after dead-code
 * elimination, on a declaration, its fields, its constructors, its type
 * parameters or the structures of its declared types, is in some
 * fingerprint, whichever printer reads it. The walk of reachability can
 * also add a removed declaration to a module; `members` then holds its
 * text too.
 *
 * Metadata that a pass after typing reads before dead-code elimination,
 * and keeps, is compared there: `GenerationChangeSet.compareMetadata`
 * reads the text of `addDeclaration` for every declaration (M2b: the
 * `:value` metadata of the statics of an enum abstract, which dead-code
 * elimination removes, and from which `SignatureCache` keeps a literal
 * union).
 *
 * Not in the fingerprint: field types (except the metadata of their
 * anonymous structures), bodies and positions. They change only when Haxe
 * types the module again, and the epochs guard that. Whether a
 * field has a body is also left out: reading it copies the complete typed
 * body in the macro interpreter, and only a new typing changes it. A macro
 * can still change metadata that only a typed body holds: that of a local
 * variable, of a local function's type parameter, or of a structure that
 * only the type of an expression names. That is not covered (limit S3 of
 * the review of genes-ts #246).
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

  /**
   * The metadata names that `addDeclaration` also leaves out, each with the
   * reason. That text is read before the passes after typing run
   * (`GenerationChangeSet.compareMetadata`), so metadata that Genes itself
   * adds later in the same callback would look like a change in the next
   * request.
   */
  public static final BEFORE_DCE_EXCLUDED_META: Map<String,
    String> = [':keep' =>
    '`PublicSurface` and `LibraryProfile` add it after the '
    + 'comparison in the first request, and it stays on a field that Haxe '
    + 'keeps. It only steers dead-code elimination, whose result the '
    + 'fingerprints after dead-code elimination (`of`, `members`) compare; '
    + 'no Genes pass derives a value from it'];

  /** True while `addDeclaration` reads a declaration (see `BEFORE_DCE_EXCLUDED_META`). */
  static var readingBeforeDce = false;

  /** Returns the fingerprint text of one module's declarations. */
  public static function of(types: Array<Type>, directives: Array<String>,
      exposed: Array<String>): String {
    final buffer = new StringBuf();
    for (type in types) {
      switch type {
        case TInst(ref, _):
          addClass(buffer, ref.get());
        case TEnum(ref, _):
          addEnum(buffer, ref.get());
        case TType(ref, _):
          addTypedef(buffer, ref.get());
        case TAbstract(ref, _):
          addAbstract(buffer, ref.get());
        default:
          buffer.add('other');
      }
      buffer.add('\n');
    }
    buffer.add('directives ${directives.join('\x01')}\n');
    buffer.add('expose ${exposed.join(',')}\n');
    return buffer.toString();
  }

  /** Adds the text of one class, as `of` describes it. */
  static function addClass(buffer: StringBuf, cls: ClassType): Void {
    buffer.add('class ${TypeUtil.baseTypeFullName(cls)}');
    final parent = cls.superClass;
    if (parent != null) {
      buffer.add(' extends ${TypeUtil.baseTypeFullName(parent.t.get())}');
      // One walk over all type arguments, so the structure numbers
      // are unique within the list.
      buffer.add(anonymousText(TInst(parent.t, parent.params)));
    }
    for (item in cls.interfaces) {
      buffer.add(' implements ${TypeUtil.baseTypeFullName(item.t.get())}');
      buffer.add(anonymousText(TInst(item.t, item.params)));
    }
    buffer.add(cls.isExtern ? ' extern' : '');
    buffer.add(cls.isInterface ? ' interface' : '');
    buffer.add(cls.init != null ? ' init' : '');
    final constructor = cls.constructor;
    if (constructor != null) {
      final made = constructor.get();
      buffer.add(' new' + metaText(made.meta));
      buffer.add(constraintText(made.params));
      buffer.add(anonymousText(made.type));
    }
    addMeta(buffer, cls.meta);
    buffer.add(constraintText(cls.params));
    for (field in cls.fields.get())
      addField(buffer, 'field', field);
    for (field in cls.statics.get())
      addField(buffer, 'static', field);
  }

  /** Adds the text of one enum, as `of` describes it. */
  static function addEnum(buffer: StringBuf, enm: EnumType): Void {
    buffer.add('enum ${TypeUtil.baseTypeFullName(enm)}');
    addMeta(buffer, enm.meta);
    buffer.add(constraintText(enm.params));
    for (name in enm.names) {
      final construct = enm.constructs.get(name);
      buffer.add('\n  constructor $name');
      if (construct != null) {
        buffer.add(metaText(construct.meta));
        buffer.add(constraintText(construct.params));
        buffer.add(anonymousText(construct.type));
      }
    }
  }

  /** Adds the text of one abstract, as `of` describes it. */
  static function addAbstract(buffer: StringBuf, abs: AbstractType): Void {
    buffer.add('abstract ${TypeUtil.baseTypeFullName(abs)}');
    addMeta(buffer, abs.meta);
    buffer.add(constraintText(abs.params));
    buffer.add(anonymousText(abs.type));
  }

  /**
   * Returns the fingerprint part for the declarations of one module that
   * are in no generator list, or an empty text when there is none: one line,
   * `unlisted <digest>`, where the digest is `Context.signature` of the
   * text that `of` gives each of these declarations, in Haxe's order.
   *
   * Why (genes-f8vc.9.27): a printer can read the metadata of a declaration
   * that dead-code elimination removed, without adding it as a member.
   * Example from the review of genes-ts #246 (M2a): the `@:ts.type` of a
   * removed class, which `TypeReferenceCollector` and `TypeEmitter` print
   * where a type names the class. A macro of another module can change that
   * metadata, and Haxe does not type the owning module again. Fixing each such reader would not end: any printer
   * can read any metadata. So the fingerprint holds every declaration that
   * Haxe typed. A declaration in a generator list gets the text of `of`; each
   * other declaration gets the same text here, with every field that it
   * still lists (a printer that walks the fields sees the same list). Rule 6
   * of `GenerationCache` then falls back when one of them changes.
   *
   * `types` is the complete declaration list of the module
   * (`TypedModuleInventory.allModules`), and `listed` says whether a
   * declaration is in the generator's list. The digest keeps the cache
   * small: removed declarations include large parts of the standard library.
   *
   * Not covered: metadata that only a typed body holds, such as that of a
   * local variable or of a local function's type parameter (limit S3 of the
   * review of genes-ts #246). Reading it would mean reading every typed body
   * in every request.
   */
  public static function unlisted(types: Array<Type>,
      listed: BaseType->Bool): String {
    final buffer = new StringBuf();
    for (type in types) {
      switch type {
        case TInst(ref, _):
          final cls = ref.get();
          if (listed(cls))
            continue;
          addClass(buffer, cls);
        case TEnum(ref, _):
          final enm = ref.get();
          if (listed(enm))
            continue;
          addEnum(buffer, enm);
        case TType(ref, _):
          final def = ref.get();
          if (listed(def))
            continue;
          addTypedef(buffer, def);
        case TAbstract(ref, _):
          final abs = ref.get();
          if (listed(abs))
            continue;
          addAbstract(buffer, abs);
        default:
          continue;
      }
      buffer.add('\n');
    }
    final text = buffer.toString();
    return text.length == 0 ? '' : 'unlisted ${Context.signature(text)}\n';
  }

  /**
   * Adds the text that `of` gives one declaration, read from a
   * `ModuleType` (as Haxe gives it to `onAfterTyping`), and a line end.
   * The first line names the declaration; each field and enum constructor
   * has a line of its own that starts with two spaces, and no metadata
   * argument adds a line end.
   * `record` is the class record when the caller already read it, so that
   * the class is not copied twice. `GenerationChangeSet.compareMetadata`
   * builds the metadata digest of each module from it.
   */
  public static function addDeclaration(buffer: StringBuf, type: ModuleType,
      ?record: ClassType): Void {
    readingBeforeDce = true;
    switch type {
      case TClassDecl(ref):
        addClass(buffer, record != null ? record : ref.get());
      case TEnumDecl(ref):
        addEnum(buffer, ref.get());
      case TTypeDecl(ref):
        addTypedef(buffer, ref.get());
      case TAbstract(ref):
        addAbstract(buffer, ref.get());
    }
    readingBeforeDce = false;
    buffer.add('\n');
  }

  /** Adds the text of one typedef, as `of` describes it. */
  static function addTypedef(buffer: StringBuf, def: DefType): Void {
    buffer.add('typedef ${TypeUtil.baseTypeFullName(def)}');
    addMeta(buffer, def.meta);
    buffer.add(constraintText(def.params));
    buffer.add(anonymousText(def.type));
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
   *
   * A member that is not in the generator's list (`listed` returns false)
   * also gets ` late` and the text that `of` gives a declaration: its
   * metadata, the metadata of its constructors and fields, its
   * type-parameter constraints and the metadata of its anonymous structures
   * (L6 of the review of genes-ts #245). Dead-code elimination removed such
   * a class or enum, so no fingerprint holds it, but a macro of another
   * module can still write metadata on it. Example: the walk adds
   * `enum inc.LateEnum { Item(data: {q: Int}); }` because a typedef field
   * names it, and an after-typing macro adds `@:ts.type("string")` to `q`.
   * Only this text shows that change; the check of
   * `IncrementalShadow.planReplay` then falls back. A listed member leaves
   * that part out, because its module's fingerprint holds it, and the cache
   * stays small.
   */
  public static function members(members: Array<genes.Module.Member>,
      listed: BaseType->Bool): String {
    final buffer = new StringBuf();
    for (member in members) {
      switch member {
        case MClass(type, params, fields):
          buffer.add('class ${TypeUtil.baseTypeFullName(type)} ${params.length}');
          for (field in fields)
            buffer.add(' ${field.isStatic ? 's' : 'i'}:${field.name}'
              + (field.getter ? '+get' : '')
              + (field.setter ? '+set' : ''));
          if (!listed(type)) {
            buffer.add(' late ');
            addClass(buffer, type);
          }
        case MEnum(type, params):
          buffer.add('enum ${TypeUtil.baseTypeFullName(type)} ${params.length}');
          if (!listed(type)) {
            buffer.add(' late ');
            addEnum(buffer, type);
          }
        case MType(type, params):
          buffer.add('typedef ${TypeUtil.baseTypeFullName(type)} ${params.length}');
          if (!listed(type)) {
            buffer.add(' late ');
            addTypedef(buffer, type);
          }
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
    buffer.add(constraintText(field.params));
    buffer.add(anonymousText(field.type));
    for (signature in field.overloads.get())
      buffer.add(' overload'
        + metaText(signature.meta)
        + constraintText(signature.params)
        + anonymousText(signature.type));
  }

  /**
   * Returns the metadata of each type parameter in `params` and the field
   * metadata of each anonymous structure in their constraints, as one text,
   * or an empty text when there is no such metadata.
   *
   * Why (L5 of the review of genes-ts #245): the TypeScript output prints a
   * constraint, for example `pick<T extends {v: number}>`. A macro of
   * another module can add `@:ts.type("string")` to `v`, and the printed
   * constraint follows it. Haxe does not type the owning module again, and
   * `anonymousText` does not enter constraints.
   *
   * The same holds for metadata on the type parameter itself (M1 of the
   * review of genes-ts #246): `TypeEmitter.emitType` prints the
   * `@:ts.type` of `T`'s own class wherever `T` is used, so a macro that
   * adds `@:ts.type("string")` to `T` of `tag<T>` changes `tag<T>` into
   * `tag<string>`.
   *
   * What: for a parameter `T` with metadata, ` <T` and its `metaText`; then
   * for constraint number `n` of `T` whose `anonymousText` is not empty,
   * ` <T.n` and that text. Example: ` <T @:ts.type("string")` or
   * ` <T.0 0.v @:ts.type("string")`.
   *
   * The constraints are read here, where a declaration or a structure
   * field lists its type parameters, never from a use of a type parameter
   * inside the walk of `anonymousText`. So a
   * constraint that names its own parameter (`T: Ordered<T>` or
   * `T: {r: Int, ?next: T}`) cannot make the walk go round: the walk meets
   * `T` again as a type without arguments and stops there.
   */
  public static function constraintText(params: Array<TypeParameter>): String {
    if (params.length == 0)
      return '';
    final buffer = new StringBuf();
    for (param in params)
      switch param.t {
        case TInst(ref, _):
          final declaration = ref.get();
          final own = metaText(declaration.meta);
          if (own.length > 0)
            buffer.add(' <${param.name}$own');
          switch declaration.kind {
            case KTypeParameter(constraints):
              for (index in 0...constraints.length) {
                final text = anonymousText(constraints[index]);
                if (text.length > 0)
                  buffer.add(' <${param.name}.$index$text');
              }
            default:
          }
        default:
      }
    return buffer.toString();
  }

  /**
   * Returns the field metadata of each anonymous structure that `type`
   * writes inline, as one text, or an empty text when no such field has
   * metadata.
   *
   * Why (L2 of the round-3 review of #244): an anonymous structure belongs to
   * the declaration whose type writes it, not to a module of its own. A
   * macro of another module can add metadata to one of its fields, for
   * example `@:ts.type("string")` on the field `x` of
   * `typedef ChainB = {final x: Int;}`, and the printed type follows it.
   * Haxe does not type the owning module again, so only the fingerprint of
   * that module can show the change. The same holds for a structure in the
   * type of a class field: a variable type, an argument, a result, or a type
   * argument such as `Array<{w: Int}>`.
   *
   * What: the walk numbers each structure that it meets, from 0. For each
   * field of a structure (sorted by name) that has metadata, it adds
   * ` <number>.<name>` and the field's `metaText`. Example:
   * ` 0.x @:ts.type("string")`. The number makes metadata that moves from
   * one structure to another change the text. A field can also declare
   * type parameters of its own, as in `{function pick<T>(item: T): T;}`
   * (M3 of the cross-model review of genes-ts #246). TypeScript prints
   * them, with their metadata and constraints, so the walk adds
   * ` <number>.<name>` and the field's `constraintText` too. Example:
   * ` 0.pick <T @:ts.type("string")`.
   *
   * The walk enters the fields of a structure, the type arguments of named
   * types, the arguments and result of functions, bound monomorphs and lazy
   * types. It does not enter the body of a named type: that body belongs to
   * the module of its declaration, whose own fingerprint holds it (rule 6
   * falls back for every module when one of them changes). For the same
   * reason it skips the structure that holds the statics of a class, enum or
   * abstract. It does not enter the constraints of a type parameter from a
   * use of that parameter either: `constraintText` reads them where they
   * are declared, which for a structure field is this walk.
   */
  public static function anonymousText(type: Null<Type>): String {
    final buffer = new StringBuf();
    var count = 0;
    function walk(type: Null<Type>): Void {
      if (type == null)
        return;
      switch type {
        case TAnonymous(ref):
          final anon = ref.get();
          switch anon.status {
            case AClassStatics(_) | AEnumStatics(_) | AAbstractStatics(_):
              return;
            default:
          }
          final index = count++;
          final fields = anon.fields.copy();
          fields.sort((left,
              right) ->
              left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
          for (field in fields) {
            final meta = metaText(field.meta);
            if (meta.length > 0)
              buffer.add(' $index.${field.name}$meta');
            final declared = constraintText(field.params);
            if (declared.length > 0)
              buffer.add(' $index.${field.name}$declared');
            walk(field.type);
          }
        case TInst(_, params) | TEnum(_, params) | TType(_, params) |
          TAbstract(_, params):
          for (param in params)
            walk(param);
        case TFun(args, result):
          for (arg in args)
            walk(arg.t);
          walk(result);
        case TDynamic(inner):
          walk(inner);
        case TMono(ref):
          walk(ref.get());
        case TLazy(get):
          walk(get());
      }
    }
    walk(type);
    return buffer.toString();
  }

  /**
   * Returns the fingerprint of a module whose declarations are all extern
   * classes: the key and the metadata of each class, then the metadata of
   * its constructor, fields, statics and overload signatures, and the
   * anonymous structures of their types (`anonymousText`).
   *
   * Why: such a module gets no output file, but other modules print what its
   * metadata says, and a macro of another module can change that without
   * typing it again. Class example: `@:jsRequire`, `@:native`. Field example
   * (L1 of the round-3 review of #244): an after-typing macro adds
   * `@:native("parseFloat")` to `inc.ExtApi.parseInt`, and the module that
   * calls it must print `globalThis.parseFloat`.
   *
   * What it leaves out, unlike `of`: the kind and access of each field, and
   * the metadata and constraints of the type parameters that the class and
   * its fields declare. Dead-code elimination keeps every extern
   * class whole, except `Math` and `Array` on JavaScript (`keep_whole_class`
   * in Haxe's `dce.ml`). In those two it removes the fields that nothing
   * uses, but it changes the kind of no field that it keeps: neither class
   * has a property with an accessor method. An extern class gets no output
   * file, and no Genes printer of another module was found that prints the
   * constraint or the metadata of a type parameter that an extern
   * declaration declares. (A type parameter of a structure field in the
   * type of an extern field is in `anonymousText`, so it is in.)
   * A field without metadata and without metadata in a structure of its
   * type adds nothing. The field part of a
   * class is stored as a digest (`Context.signature`), so the large `js.*`
   * externs add about 40 characters each to the cache, not their full
   * metadata text. Example line:
   * `extern inc.ExtApi @:native("globalThis") fields 0f3c...`.
   *
   * The caller passes the classes that it read to find that the module holds
   * extern classes only, so each class is read once.
   *
   * Cost: Haxe copies every field of every extern class into the macro
   * interpreter to give this text. On the shadow fixture (318 extern-only
   * `js.*` modules) that is most of the added time. A lazy form that reads
   * only the externs that other modules use would need a complete list of
   * the extern classes that each module's typed expressions and types name.
   * No Genes walk gives that list today (a field read through a value of an
   * extern type adds no dependency edge), and a missed extern would be a
   * stale replay, so every extern-only module is read.
   */
  public static function ofExtern(classes: Array<ClassType>): String {
    final buffer = new StringBuf();
    for (cls in classes) {
      buffer.add('extern ${TypeUtil.baseTypeFullName(cls)}');
      addMeta(buffer, cls.meta);
      final fields = new StringBuf();
      final constructor = cls.constructor;
      if (constructor != null)
        addExternField(fields, 'new', constructor.get());
      for (field in cls.fields.get())
        addExternField(fields, 'i', field);
      for (field in cls.statics.get())
        addExternField(fields, 's', field);
      final text = fields.toString();
      if (text.length > 0)
        buffer.add(' fields ' + Context.signature(text));
      buffer.add('\n');
    }
    return buffer.toString();
  }

  /**
   * Adds ` <label>:<name>` with the metadata and structures of one extern
   * field, then ` <n>` with those of its overload signature number `n`. A
   * part without metadata adds nothing, so that the large `js.*` externs
   * add little text.
   */
  static function addExternField(buffer: StringBuf, label: String,
      field: ClassField): Void {
    final own = metaText(field.meta) + anonymousText(field.type);
    final inner = new StringBuf();
    var index = 0;
    for (signature in field.overloads.get()) {
      final text = metaText(signature.meta) + anonymousText(signature.type);
      if (text.length > 0)
        inner.add(' $index$text');
      index++;
    }
    final overloads = inner.toString();
    if (own.length > 0 || overloads.length > 0)
      buffer.add(' $label:${field.name}$own$overloads');
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
    final all = meta.get();
    if (all.length == 0)
      return '';
    final entries = new Map<String, Bool>();
    for (entry in all)
      if (!EXCLUDED_META.exists(entry.name)
        && !(readingBeforeDce && BEFORE_DCE_EXCLUDED_META.exists(entry.name)))
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
    final text = '@${entry.name}(${[for (param in params) ExprTools.toString(param)].join(', ')})';
    // `GenerationChangeSet.compareMetadata` compares the text line by line,
    // so an argument that prints on several lines must stay on one.
    return readingBeforeDce ? StringTools.replace(text, '\n', '\\n') : text;
  }
}
#end
