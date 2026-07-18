package genes.util;

import haxe.macro.Expr;
import haxe.macro.Type;
import haxe.macro.Context;

using haxe.macro.TypeTools;
using haxe.macro.TypedExprTools;

class TypeUtil {
  /**
   * Loads compiler-owned helper types at the earliest safe lifecycle point.
   *
   * Why: dependency planning needs typed declarations for `genes.Register`
   * and `js.Boot`. Haxe 4 allows those lookups while this macro utility is
   * initialized, but Haxe 5 requires initialization macros to finish first.
   *
   * What: each supported compiler follows its native safe timing. Keeping the
   * Haxe 4 path eager also preserves its established typing and output order;
   * moving that lookup later changes otherwise unrelated generated code.
   *
   * How: Haxe 5 fills read-only fields from `onAfterInitMacros`. Haxe 4 keeps
   * the proven eager values. Neither path stores weak names or process-global
   * typed objects, so compiler-server builds still receive current declarations.
   */
  #if (haxe_ver >= 5)
  public static var registerType(default, null): ModuleType;
  public static var bootType(default, null): ModuleType;

  static final contextTypesScheduled = scheduleContextTypes();

  static function scheduleContextTypes(): Bool {
    Context.onAfterInitMacros(() -> {
      registerType = getModuleType('genes.Register');
      bootType = getModuleType('js.Boot');
    });
    return true;
  }
  #else
  public static final registerType = getModuleType('genes.Register');
  public static final bootType = getModuleType('js.Boot');
  #end

  public static function typeToModuleType(type: Type): ModuleType
    return switch type {
      case TEnum(r, _): TEnumDecl(r);
      case TInst(r, _): TClassDecl(r);
      case TType(r, _): TTypeDecl(r);
      case TAbstract(r, _): TAbstract(r);
      case _: null;
    }

  public static function typeToBaseType(type: Type): BaseType
    return switch type {
      case TEnum((_.get() : BaseType) => base, _): base;
      case TInst((_.get() : BaseType) => base, _): base;
      case TType((_.get() : BaseType) => base, _): base;
      case TAbstract((_.get() : BaseType) => base, _): base;
      case _: null;
    }

  public static function getModuleType(module: String)
    return typeToModuleType(Context.getType(module));

  public static function baseTypeFullName(type: BaseType) {
    return type.module + '.' + type.name;
  }

  public static function block(e: TypedExpr): TypedExpr
    return switch e.expr {
      case TBlock(_): e;
      case _: {expr: TBlock([e]), t: e.t, pos: e.pos}
    }

  public static function addObjectdeclParens(e: TypedExpr): TypedExpr {
    function loop(e: TypedExpr): TypedExpr
      return switch (e.expr) {
        case TCast(e1, null), TMeta(_, e1): loop(e1);
        case TObjectDecl(_): with(e, TParenthesis(e));
        case _: e;
      }
    return loop(e);
  }

  /**
   * Extracts the literal placeholder template from `js.Syntax.code`.
   *
   * Why: raw syntax is intentionally opaque to the Haxe typed AST, but a
   * printer still needs one conservative precedence fact when the expression
   * becomes the receiver of `.` or `[]`. Keeping extraction here gives the TS
   * and classic JS emitters the same answer instead of target-specific string
   * heuristics.
   *
   * What/How: unwrap only typed nodes with no independent runtime meaning
   * (metadata, implicit casts, and parentheses), then accept a literal template
   * with at least one placeholder argument. Calls such as
   * `js.Syntax.code("$global")` remain opaque special forms and return `null`.
   */
  public static function rawSyntaxCodeTemplate(e: TypedExpr): Null<String> {
    function unwrap(value: TypedExpr): TypedExpr
      return switch value.expr {
        case TMeta(_, inner) | TCast(inner, null) | TParenthesis(inner):
          unwrap(inner);
        default:
          value;
      }

    return switch unwrap(e).expr {
      case TCall({
        expr: TField(_,
          FStatic(_.get() => {module: 'js.Syntax'},
            _.get() => {name: 'code'}))
      }, args) if (args.length > 1):
        switch args[0].expr {
          case TConst(TString(template)):
            template;
          default:
            null;
        }
      default:
        null;
    }
  }

  /**
   * Reports whether a raw-syntax expression needs receiver parentheses.
   *
   * Why: property/index access binds into the rightmost operand of templates
   * such as `await {0}` or `{0} ?? null`. Emitting either template directly as
   * a receiver changes runtime meaning even though the generated file parses.
   *
   * What/How: the identity template `{0}` is the only placeholder form whose
   * precedence is exactly its argument's and can use normal emitter rules.
   * Every other recognized template is wrapped as a unit. This deliberately
   * avoids maintaining an incomplete JavaScript/TypeScript precedence parser.
   */
  public static function rawSyntaxReceiverNeedsParens(e: TypedExpr): Bool {
    final template = rawSyntaxCodeTemplate(e);
    return template != null && StringTools.trim(template) != "{0}";
  }

  /**
   * Reports whether a null-comparison operand emits a hidden `??` expression.
   *
   * Why: Haxe sees helpers such as `Undefinable<T>.orNull()` as one typed value,
   * but the helper lowers through `js.Syntax.code("{0} ?? null", value)`. Without
   * an explicit boundary, JavaScript parses `value ?? null != null` as
   * `value ?? (null != null)`, returning a present object instead of `true`.
   * This is a shared runtime fact, not a TypeScript typechecking concern.
   *
   * What/How: recognize explicit Haxe null-coalescing and literal raw templates
   * containing the nullish operator. Both output profiles use this conservative
   * fact only when either side of `==`/`!=` is null, avoiding a full parser for
   * user-owned raw JavaScript while preserving the intended Haxe comparison.
   */
  public static function nullComparisonOperandNeedsParens(e: TypedExpr): Bool {
    function unwrap(value: TypedExpr): TypedExpr
      return switch value.expr {
        case TMeta(_, inner) | TCast(inner, null) | TParenthesis(inner):
          unwrap(inner);
        default:
          value;
      }

    return switch unwrap(e).expr {
      #if (haxe_ver >= 4.3)
      case TBinop(OpNullCoal, _, _):
        true;
      #end
      default:
        final template = rawSyntaxCodeTemplate(e);
        template != null && template.indexOf('??') != -1;
    }
  }

  /** Returns whether an expression is a null literal after inert wrappers. */
  public static function isNullConstant(e: TypedExpr): Bool {
    return switch e.expr {
      case TMeta(_, inner) | TCast(inner, null) | TParenthesis(inner):
        isNullConstant(inner);
      case TConst(TNull):
        true;
      default:
        false;
    }
  }

  /**
   * Returns the runtime/member name requested by `@:native`.
   *
   * Why: Haxe code often needs a legal Haxe identifier for a field whose
   * JavaScript shape uses a reserved word or external API spelling, for example
   * `@:native("function") final fn:...`. The Haxe name must stay available for
   * typechecking, but emitted JS/TS must use the native property name.
   *
   * What/How: only the literal-string metadata form is considered here. Other
   * metadata shapes are ignored so diagnostics can remain centralized in a
   * future metadata validation pass rather than scattered through emitters.
   */
  public static function nativeName(meta: Null<MetaAccess>): Null<String> {
    if (meta == null)
      return null;
    return switch meta.extract(':native') {
      case [{params: [{expr: EConst(CString(name))}]}]:
        name;
      default:
        null;
    }
  }

  public static function classFieldName(field: ClassField): String {
    final native = nativeName(field.meta);
    return native != null ? native : field.name;
  }

  /**
   * Finds an anonymous-object field visible through the destination type.
   *
   * Why: codegen often sees object literals through a destination type rather
   * than through the literal's own inferred type. Typedefs and Haxe abstracts
   * over anonymous records can carry field metadata such as `@:native` or
   * `genes.ts.Undefinable<T>` contracts that the literal expression no longer
   * exposes on its own.
   *
   * How: `followWithAbstracts` peels typedefs and abstract wrappers until an
   * anonymous record is found. This is contextual metadata lookup only; it does
   * not change the Haxe type or force arbitrary abstract conversions.
   */
  public static function anonymousField(type: Type,
      name: String): Null<ClassField> {
    final eitherField = anonymousEitherField(type, name);
    if (eitherField != null)
      return eitherField;

    return switch Context.followWithAbstracts(type) {
      case TAnonymous(_.get() => anon):
        var found: Null<ClassField> = null;
        for (field in anon.fields)
          if (field.name == name) {
            found = field;
            break;
          }
        found;
      case TLazy(f):
        anonymousField(f(), name);
      default:
        null;
    }
  }

  /**
   * Finds object-field metadata through a `haxe.extern.EitherType` arm.
   *
   * Why: Haxe uses `EitherType<A, B>` for TypeScript-style unions at JS
   * boundaries. When an object literal is assigned to the object arm, the
   * literal itself may not carry typedef field metadata such as
   * `@:native("function")`, while the union destination still does through one
   * of its parameters.
   *
   * What/How: inspect each `EitherType` parameter before `followWithAbstracts`
   * erases the abstract to `Dynamic`. The first arm that exposes the requested
   * anonymous field supplies the contextual metadata. This is metadata lookup
   * only; it does not choose a runtime union representation or add casts.
   */
  static function anonymousEitherField(type: Type,
      name: String): Null<ClassField> {
    return switch type {
      case TAbstract(_.get() => {module: 'haxe.extern.EitherType', name: 'EitherType'}, params):
        for (param in params) {
          final field = anonymousField(param, name);
          if (field != null)
            return field;
        }
        null;
      case TType(_, _):
        anonymousEitherField(Context.follow(type), name);
      case TLazy(f):
        anonymousEitherField(f(), name);
      default:
        null;
    }
  }

  public static function anonymousFieldType(type: Type,
      name: String): Null<Type> {
    final field = anonymousField(type, name);
    return field == null ? null : field.type;
  }

  public static function anonymousFieldName(type: Type, name: String): String {
    final field = anonymousField(type, name);
    return field == null ? name : classFieldName(field);
  }

  /**
   * Returns the element type of an array-like destination type.
   *
   * Why: object literals nested inside `Array<T>` need the same destination
   * metadata as direct returns or assignments. Without threading the element
   * type into each array entry, anonymous-field metadata such as `@:native`
   * can be lost before the object literal is emitted.
   */
  public static function arrayElementType(type: Null<Type>): Null<Type> {
    if (type == null)
      return null;
    return switch Context.followWithAbstracts(type) {
      case TInst(_.get() => {pack: [], name: 'Array'}, [element]):
        element;
      case TLazy(f):
        arrayElementType(f());
      default:
        null;
    }
  }

  public static function fieldName(f: FieldAccess): String
    return switch f {
      case FAnon(f), FInstance(_, _, f), FStatic(_, f), FClosure(_, f):
        classFieldName(f.get());
      case FEnum(_, f): f.name;
      case FDynamic(n): n;
    }

  // https://github.com/HaxeFoundation/haxe/blob/682b8e3407cf04bb0b81275d6543cc9c45e00e89/src/generators/genjs.ml#L251
  static function isDynamicType(type: Type): Bool {
    return switch Context.followWithAbstracts(type) {
      case TInst(_.get() => {name: 'Array', pack: []}, _) |
        TInst(_.get() => {kind: KTypeParameter(_)}, _) | TAnonymous(_) |
        TDynamic(_) | TMono(_):
        true;
      case _:
        false;
    }
  }

  public static function isDynamicIterator(x: TypedExpr): Bool
    return isDynamicType(x.t);

  public static function posInfo(fields: Array<{name: String, expr: TypedExpr}>)
    return switch [fields[0], fields[1]] {
      case [
        {name: 'fileName', expr: {expr: TConst(TString(file))}},
        {name: 'lineNumber', expr: {expr: TConst(TInt(line))}}
      ]:
        {file: file, line: line}
      case _: null;
    }

  public static function with(e: TypedExpr, ?edef: TypedExprDef, ?t: Type) {
    return {
      expr: edef == null ? e.expr : edef,
      pos: e.pos,
      t: t == null ? e.t : t
    }
  }

  public static function isRest(type: Type) {
    return switch type {
      case TType(_.get() => {module: 'haxe.extern.Rest', name: 'Rest'}, _) |
        TAbstract(_.get() => {module: 'haxe.Rest', name: 'Rest'}, _):
        true;
      default:
        false;
    }
  }

  public static function moduleTypeModule(module: ModuleType) {
    return switch module {
      case TClassDecl(_.get() => {module: module}): module;
      case TEnumDecl(_.get() => {module: module}): module;
      case TTypeDecl(_.get() => {module: module}): module;
      default: '';
    }
  }

  public static function moduleTypeName(module: ModuleType) {
    return switch module {
      case TClassDecl(_.get() => cl): className(cl);
      case TEnumDecl(_.get() => {name: name}): name;
      case TTypeDecl(_.get() => {name: name}): name;
      default: '';
    }
  }

  /**
   * Finds the exact class shape represented by a shared Haxe `BaseType`.
   *
   * Why: classes, enums, typedefs, and abstracts all expose `BaseType`, but
   * class-only fields such as `kind` and `statics` are not safe to read from
   * that shared surface. Older code checked the runtime object with reflection
   * and then cast it, even though Haxe already owns the typed declaration.
   *
   * What: ordinary classes return their `ClassType`. An abstract returns its
   * generated implementation class when one exists; this is the class that
   * owns enum-abstract constants and methods in the typed expression tree.
   * Other declaration kinds return `null`.
   *
   * How: the lookup compares the full module and declaration names in Haxe's
   * module inventory. It also compares an abstract's implementation name, so
   * callers work whether the compiler supplied the authored abstract base or
   * its generated implementation base. No source position or object-shape
   * guess becomes type identity.
   */
  public static function classTypeForBase(base: BaseType): Null<ClassType> {
    function sameDeclaration(candidate: BaseType): Bool {
      return candidate.module == base.module && candidate.name == base.name;
    }

    for (candidate in Context.getModule(base.module)) {
      switch candidate {
        case TInst(ref, _):
          final cl = ref.get();
          if (sameDeclaration(cl))
            return cl;
        case TAbstract(ref, _):
          final abstractType = ref.get();
          final implementation = abstractType.impl;
          if (implementation != null) {
            final cl = implementation.get();
            if (sameDeclaration(abstractType) || sameDeclaration(cl))
              return cl;
          }
        default:
      }
    }
    return null;
  }

  /**
   * Returns the source-level name that Genes should print for a `BaseType`.
   *
   * Why: an extern abstract and its compiler-generated implementation class
   * are related, but they are not interchangeable here. The authored abstract
   * keeps its own name; only a real class or implementation-class value needs
   * `className`'s special handling.
   *
   * How: Haxe's typed module inventory tells us which declaration owns the
   * shared `BaseType`. We check authored declarations first, then accept an
   * implementation-class name only when the supplied base actually names that
   * class. This preserves the old output without reflection or a cast.
   */
  public static function baseTypeName(base: BaseType) {
    final moduleTypes = Context.getModule(base.module);

    for (candidate in moduleTypes) {
      switch candidate {
        case TInst(ref, _):
          final cl = ref.get();
          if (cl.module == base.module && cl.name == base.name)
            return className(cl);
        case TEnum(ref, _):
          final en = ref.get();
          if (en.module == base.module && en.name == base.name)
            return en.name;
        case TType(ref, _):
          final typedefType = ref.get();
          if (typedefType.module == base.module && typedefType.name == base.name)
            return typedefType.name;
        case TAbstract(ref, _):
          final abstractType = ref.get();
          if (abstractType.module == base.module && abstractType.name == base.name)
            return abstractType.name;
        default:
      }
    }

    for (candidate in moduleTypes) {
      switch candidate {
        case TAbstract(ref, _):
          final implementation = ref.get().impl;
          if (implementation != null) {
            final cl = implementation.get();
            if (cl.module == base.module && cl.name == base.name)
              return className(cl);
          }
        default:
      }
    }

    return base.name;
  }

  public static function typeName(module: Type) {
    return switch module {
      case TInst(_.get() => cl, _): className(cl);
      default: typeToBaseType(module).name;
    }
  }

  public static function className(cl: ClassType) {
    return switch cl {
      case {kind: KAbstractImpl(_.get() => a), meta: meta}
        if (!meta.has(':native')):
        a.name;
      default: cl.name;
    }
  }

  public static function typesInExpr(e: TypedExpr): Array<ModuleType> {
    return switch e {
      case null: [];
      case {
        expr: TCall(call = {
          expr: TField(_,
            FStatic(_.get() => {module: 'genes.Genes'},
              _.get() => {name: 'ignore'}))
        }, [{expr: TArrayDecl(texprs)}, func])
      }:
        final names = [
          for (texpr in texprs)
            switch texpr {
              case {expr: TConst(TString(name))}:
                name;
              case _:
                continue; // TODO: should error
            }
        ];
        typesInExpr(call).concat(typesInExpr(func).filter(type -> {
          return switch type {
            case TClassDecl(TInst(_, []).toString() => name) |
              TEnumDecl(TEnum(_, []).toString() => name):
              names.indexOf(name) < 0;
            default: true;
          }
        }));
      case {expr: TTypeExpr(t)}:
        [t];
      case {expr: TNew(c, _, el)}:
        var res = [TClassDecl(c)];
        for (e in el)
          res = res.concat(typesInExpr(e));
        res;
      case {expr: TCast(e, null)}:
        typesInExpr(e);
      case {expr: TCast(e, t)}:
        typesInExpr(e)
          .concat([t, bootType]); // include js.Boot for js.Boot.__cast()
      case e:
        var res = [];
        e.iter(e -> {
          res = res.concat(typesInExpr(e));
        });
        res;
    }
  }
}
