package genes.es;

import haxe.macro.Expr;
import haxe.macro.Context;
import haxe.macro.Type;
import haxe.ds.Option;
import helder.Set;
import genes.TypeAccessor;
import genes.CompilerDiagnostic;
import genes.CompilerInternal;
import genes.Dependencies;
import genes.Module;
import genes.NamePlan;
import genes.NamePlan.NamePlanProfile;
import genes.TempPlan;
import genes.TempPlan.LoweredForIterator;
import genes.NullishContract;
import genes.JsxPlan;
import genes.JsxPlan.JsxCapabilityPolicy;
import genes.JsxPlan.JsxEmissionProfile;
import genes.JsxPlan.JsxSourceInlineConsumer;
import genes.JsxPlan.JsxIntent;
import genes.JsxPlan.JsxChildIntent;
import genes.JsxPlan.JsxPropIntent;
import genes.JsxPlan.JsxTagIntent;
import genes.JsxPlan.JsxValueAccess;
import genes.JsxPlan.JsxValueSource;
import genes.TemplateLiteralPlan;
import genes.TemplateLiteralPlan.TemplateLiteralIntent;
import genes.util.TypeUtil.*;
import genes.util.IteratorUtil.*;

using haxe.macro.TypedExprTools;

class ExprEmitter extends Emitter {
  static final keywords = new Set([
    'abstract',
    'boolean',
    'break',
    'byte',
    'case',
    'catch',
    'char',
    'class',
    'const',
    'continue',
    'debugger',
    'default',
    'delete',
    'do',
    'double',
    'else',
    'enum',
    'export',
    'extends',
    'false',
    'final',
    'finally',
    'float',
    'for',
    'function',
    'goto',
    'if',
    'implements',
    'import',
    'in',
    'instanceof',
    'int',
    'interface',
    'long',
    'native',
    'new',
    'null',
    'package',
    'private',
    'protected',
    'public',
    'return',
    'short',
    'static',
    'super',
    'switch',
    'synchronized',
    'this',
    'throw',
    'throws',
    'transient',
    'true',
    'try',
    'typeof',
    'var',
    'void',
    'volatile',
    'while',
    'with',
    'arguments',
    'eval',
    'let',
    'yield'
  ]);
  static final keywordsLocal = new Set([
    "Infinity",
    "NaN",
    "decodeURI",
    "decodeURIComponent",
    "encodeURI",
    "encodeURIComponent",
    "escape",
    "eval",
    "isFinite",
    "isNaN",
    "parseFloat",
    "parseInt",
    "undefined",
    "unescape",
    "JSON",
    "Number",
    "Object",
    "console",
    "window",
    "require"
  ]);

  var indent: Int = 0;
  var valueIifeDepth: Int = 0;
  var inLoop: Bool = false;
  var extendsExtern: Option<TypeAccessor> = None;
  var currentExpectedValueType: Null<Type> = null;
  var currentReturnType: Null<Type> = null;
  var jsxPlan: Null<JsxPlan> = null;
  var templateLiteralPlan: Null<TemplateLiteralPlan> = null;
  var jsxRuntimeBinding: Null<String> = null;
  var jsxEmissionProfile: Null<JsxEmissionProfile> = null;
  var jsxSourceInlineConsumer: Null<JsxSourceInlineConsumer> = null;
  var namePlan: Null<NamePlan> = null;
  var tempPlan: Null<TempPlan> = null;
  var directImportLocals: Array<String> = [];

  var declare = #if (js_es == 6) 'let'; #else 'var'; #end

  /**
   * Installs the immutable JSX facts and their profile-specific capability.
   *
   * Module emitters call this once before printing imports. The semantic plan
   * is shared; only `emitJsxIntent` is target-polymorphic. Resolving the runtime
   * name through `Dependencies` ensures the expression printer uses the exact
   * namespace alias that the import printer selected after collision handling.
   */
  public function configureJsx(plan: JsxPlan,
      capability: JsxCapabilityPolicy, dependencies: Dependencies): Void {
    jsxPlan = plan;
    jsxEmissionProfile = capability.profile;
    jsxRuntimeBinding = capability.resolveRuntimeBinding(dependencies, plan);
    jsxSourceInlineConsumer = emitsJsxSource()
      ? plan.sourceInlineConsumer(capability.profile)
      : null;
  }

  /** Whether Haxe introduced this local solely for the typed JSX carrier. */
  function isJsxCarrierLocal(id: Int): Bool {
    return jsxPlan != null && jsxPlan.isCarrierLocal(id);
  }

  /** True only when this printer preserves JSX syntax in emitted source. */
  function emitsJsxSource(): Bool {
    return jsxEmissionProfile == JavaScriptJsxAutomatic;
  }

  /** Resolves one planned source-only JSX local without affecting call output. */
  function sourceInlineJsxValue(expression: TypedExpr): TypedExpr {
    if (!emitsJsxSource() || jsxSourceInlineConsumer == null)
      return expression;
    final initializer = jsxSourceInlineConsumer.initializerForChildValue(
      expression);
    return initializer == null ? expression : initializer;
  }

  /** Whether a macro-created JSX declaration is replaced at its sole child use. */
  function skipsSourceInlineJsxDeclaration(expression: TypedExpr): Bool {
    if (!emitsJsxSource() || jsxSourceInlineConsumer == null)
      return false;
    return jsxSourceInlineConsumer.initializerForDeclaration(expression) != null;
  }

  /** Validates exact source-inline consumption before the writer is closed. */
  override public function finish(): Void {
    if (jsxSourceInlineConsumer != null)
      jsxSourceInlineConsumer.validate();
    super.finish();
  }

  /** Installs the validated target-neutral string-template plan. */
  public function configureTemplateLiterals(plan:TemplateLiteralPlan):Void {
    templateLiteralPlan = plan;
  }

  /**
   * Installs target-neutral temporary facts and the selected naming projection.
   *
   * Why: local allocation used to happen while expressions were being printed,
   * so formatting order could alter later identifiers and TS/classic could make
   * independent iterator-temporary decisions.
   *
   * What/How: `TempPlan` first captures semantic reuse and Haxe-generated local
   * identity. `NamePlan` then precomputes the profile spelling for every TVar.
   * Expression emission performs lookup only. TypeScript requests collision-
   * safe readable names; classic Genes preserves its vanilla-compatible names.
   */
  public function configureLowering(module: Module, profile: NamePlanProfile,
      jsxEmitTsx = false): Void {
    tempPlan = TempPlan.build(module);
    namePlan = NamePlan.build(module, tempPlan, profile, jsxEmitTsx);
  }

  /**
   * Emits the local values created by `Genes.dynamicImport` without a static import.
   *
   * Why: the macro deliberately removes these declarations from the normal
   * dependency graph, then creates callback-local values after `import()`
   * resolves. Exact import lookup must not reject those values or accidentally
   * add a top-level ESM import that defeats code splitting.
   *
   * What/How: the existing `Genes.ignore([full names], body)` carrier names the
   * declarations that are local only inside `body`. This method scopes that
   * compiler-owned list while emitting the body. Every other type expression
   * still requires an exact origin-to-binding mapping.
   */
  function withDirectImportLocals(names: TypedExpr, emit: Void->Void): Void {
    final previous = directImportLocals;
    final scoped = previous.copy();
    switch names.expr {
      case TArrayDecl(values):
        for (value in values)
          switch value.expr {
            case TConst(TString(fullName)):
              if (scoped.indexOf(fullName) == -1)
                scoped.push(fullName);
            default:
          }
      default:
    }
    directImportLocals = scoped;
    final previousAccessor = ctx.typeAccessor;
    ctx.typeAccessor = type -> {
      final local = directImportLocalName(type);
      return local == null ? previousAccessor(type) : local;
    };
    emit();
    ctx.typeAccessor = previousAccessor;
    directImportLocals = previous;
  }

  /** Returns the callback-local spelling for an exact dynamic-import origin. */
  function directImportLocalName(type: TypeAccessor): Null<String> {
    return switch type {
      case ImportedDeclaration(key, fallbackName, _, _, _):
        final moduleParts = key.module.split('.');
        moduleParts.pop();
        final sourceName = moduleParts.concat([key.name]).join('.');
        final qualifiedModuleName = key.module + '.' + key.name;
        directImportLocals.indexOf(key.module) != -1
          || directImportLocals.indexOf(sourceName) != -1
          || directImportLocals.indexOf(qualifiedModuleName) != -1
          ? fallbackName
          : null;
      default: null;
    }
  }

  function isDirectImportLocal(type: ModuleType): Bool {
    final base = DependencyPlan.moduleTypeBase(type);
    final declaredName = base.pack.concat([base.name]).join('.');
    return directImportLocals.indexOf(declaredName) != -1
      || directImportLocals.indexOf(baseTypeFullName(base)) != -1;
  }

  /**
   * Emits a value that will immediately receive property or index access.
   *
   * Raw syntax templates are opaque expressions, so their internal operators
   * cannot safely participate in the surrounding access precedence. The shared
   * `TypeUtil` fact wraps non-identity templates as one semantic value while
   * retaining the classic emitter's existing object-literal protection.
   */
  function emitAccessReceiver(receiver: TypedExpr): Void {
    final value = addObjectdeclParens(receiver);
    final wrapRawSyntax = rawSyntaxReceiverNeedsParens(value);
    if (wrapRawSyntax)
      write('(');
    emitValue(value);
    if (wrapRawSyntax)
      write(')');
  }

  /**
   * Emits a literal `js.Syntax.code` template through Genes-owned expressions.
   *
   * Why: delegating the entire raw-syntax call to Haxe's stock JS printer also
   * delegates each `{n}` argument. That printer uses flat internal names for
   * Haxe module-level fields, while Genes emits ESM imports and accesses those
   * fields through their imported module container. Mixing the two name plans
   * produces valid-looking output with an undefined identifier at runtime.
   *
   * What/How: the author still owns every non-placeholder byte of the literal
   * template. Numeric placeholders are expanded with this emitter's ordinary
   * value path, preserving dependency aliases, module-field access, temporary
   * names, and target-specific expression rules. The TypeScript emitter
   * overrides only `emitRawSyntaxTemplateValue` for its explicit-undefined
   * boundary; parsing and accessor ownership remain shared by both profiles.
   * Non-literal or argument-free forms return `false` so established special
   * cases such as `js.Syntax.code("$global")` stay on the stock fallback path.
   */
  public function emitSyntaxCodeWithArgs(args: Array<TypedExpr>): Bool {
    if (args.length <= 1)
      return false;

    final template = switch args[0].expr {
      case TConst(TString(value)):
        value;
      default:
        return false;
    }

    final values = args.slice(1);
    var i = 0;
    while (i < template.length) {
      if (template.charCodeAt(i) == "{".code) {
        var j = i + 1;
        var index = 0;
        var hasDigits = false;
        while (j < template.length) {
          final code = template.charCodeAt(j);
          if (code < "0".code || code > "9".code)
            break;
          hasDigits = true;
          index = index * 10 + (code - "0".code);
          j++;
        }
        if (hasDigits && j < template.length
          && template.charCodeAt(j) == "}".code) {
          if (index >= values.length) {
            CompilerDiagnostic.fail('js.Syntax.code placeholder {$index} has no argument',
              args[0].pos);
          }
          emitRawSyntaxTemplateValue(values[index]);
          i = j + 1;
          continue;
        }
      }
      write(template.charAt(i));
      i++;
    }
    return true;
  }

  /**
   * Emits one raw-template placeholder using the active target's value rules.
   *
   * Classic JavaScript needs no special boundary behavior. TypeScript extends
   * this hook to retain literal JavaScript `undefined` instead of applying its
   * ordinary Haxe-null normalization while inside a raw syntax contract.
   */
  public function emitRawSyntaxTemplateValue(value: TypedExpr): Void {
    emitValue(value);
  }

  /**
   * Emits the narrow legacy `__js__("identifier")` form used by older externs.
   *
   * Why: hxnodejs 10 exposes Node globals such as `process` and `console`
   * through Haxe's former `__js__` intrinsic. Haxe 5 leaves that call visible
   * in the typed tree, and delegating it prints a nonexistent `__js__` function
   * into generated TypeScript and JavaScript.
   *
   * What: Genes accepts only one literal, ASCII JavaScript identifier. This is
   * enough for the old global-access contract without treating an arbitrary
   * source string as compiler-owned code.
   *
   * How: the validated identifier is written as the value that Haxe 4 already
   * produced. Calls with arguments, operators, or nonliteral text remain on the
   * existing backend path; this compatibility rule does not broaden raw syntax.
   */
  function emitLegacyJsIdentifier(args: Array<TypedExpr>): Bool {
    if (args.length != 1)
      return false;
    final identifier = switch args[0].expr {
      case TConst(TString(value)): value;
      default: return false;
    }
    if (identifier.length == 0)
      return false;

    for (index in 0...identifier.length) {
      final code = identifier.charCodeAt(index);
      final letter = (code >= "A".code && code <= "Z".code)
        || (code >= "a".code && code <= "z".code);
      final allowed = letter || code == "_".code || code == "$".code
        || (index > 0 && code >= "0".code && code <= "9".code);
      if (!allowed)
        return false;
    }

    write(identifier);
    return true;
  }

  /** Emits one null-comparison operand with its hidden nullish syntax grouped. */
  function emitNullComparisonOperand(value: TypedExpr): Void {
    final wrap = nullComparisonOperandNeedsParens(value);
    if (wrap)
      write('(');
    emitValue(value);
    if (wrap)
      write(')');
  }

  public function emitExpr(e: TypedExpr) {
    if (CompilerInternal.isSideEffectImportMarkerCall(e))
      return;
    emitPos(e.pos);
    switch e.expr {
      case TConst(c):
        emitConstant(c);
      case TLocal(v):
        emitLocalVar(v);
      case TArray(e1, e2):
        emitAccessReceiver(e1);
        write('[');
        emitValue(e2);
        write(']');
      case TBinop(op, {expr: TField(x, f)}, e2) if (fieldName(f) == 'iterator'):
        emitValue(x);
        emitField('iterator');
        writeSpace();
        writeBinop(op);
        writeSpace();
        emitValue(e2);
      case TBinop(op = OpEq | OpNotEq, e1, e2)
        if (isNullConstant(e1) || isNullConstant(e2)):
        emitNullComparisonOperand(e1);
        writeSpace();
        writeBinop(op);
        writeSpace();
        emitNullComparisonOperand(e2);
      case TBinop(op, e1, e2):
        emitValue(e1);
        writeSpace();
        writeBinop(op);
        writeSpace();
        switch op {
          case OpAssign | OpAssignOp(_):
            emitValueWithExpectedType(e1.t, e2);
          default:
            emitValue(e2);
        }
      case TField(x, f) if (fieldName(f) == "iterator" && isDynamicIterator(x)):
        switch (f) {
          case FStatic(c, cf):
            emitValue(x);
            emitField("iterator");
          default:
            ctx.addFeature("use.$iterator");
            write(ctx.typeAccessor(registerType));
            write('.iterator(');
            emitValue(x);
            write(')');
        }
      case TUnop(op, postFix, fe = {expr: TField(x, f)})
        if (fieldName(f) == 'iterator' && isDynamicIterator(x)):
        switch postFix {
          case false:
            writeUnop(op);
            emitValue(x);
            write('.iterator');
          case true:
            emitValue(x);
            write('.iterator');
            writeUnop(op);
        }
      /*
        case TField(x, FClosure(Some({c:{cl_path:{a:[], b:"Array"}}}), {cf_name:"push"})):
          // see https://github.com/HaxeFoundation/haxe/issues/1997
          add_feature(ctx, "use.$arrayPush");
          add_feature(ctx, "use.$bind");
          print(ctx, "$bind(");
          gen_emitValue(ctx, x);
          print(ctx, ",$arrayPush");
       */
      case TField(x, FClosure(_, _.get() => {name: name})):
        final receiver = simpleBindReceiver(x);
        switch (receiver.expr) {
          case TConst(_) | TLocal(_):
            write(ctx.typeAccessor(registerType));
            write('.bind(');
            emitValue(receiver);
            write(', ');
            emitValue(receiver);
            emitField(name);
            write(')');
          case _:
            // Todo: figure out this mess, also take care of selfCall
            write('(o=>');
            write(ctx.typeAccessor(registerType));
            write('.bind(o, o');
            emitField(name);
            write('))(');
            emitValue(x);
            write(')');
        }
      case TEnumIndex(x):
        emitValue(x);
        write("._hx_index");
      case TEnumParameter(x, f, i):
        emitValue(x);
        emitField(switch f.type {
          case TFun(args, _): args[i].name;
          case _: throw 'assert';
        });
      case TField(_, FStatic(owner, _.get() => field)) if (field.meta.has(':jsRequire')):
        emitJsRequireField(owner.get(), field);
      case TField(_, FStatic(_.get() => {
        pack: [],
        name: ''
      }, _.get().name => fname)):
        write(fname);
      case TField(x,
        FInstance(_, _,
          _.get() => f) | FStatic(_, _.get() => f) | FAnon(_.get() => f))
        if (f.meta.has(':selfCall')):
        emitValue(x);
      case TField(x, f):
        function skip(e: TypedExpr): TypedExpr
          return switch e.expr {
            case TCast(e1, null) | TMeta(_, e1): skip(e1);
            case TConst(TInt(_) | TFloat(_)) | TObjectDecl(_): with(e,
                TParenthesis(e));
            case _: e;
          }
        emitAccessReceiver(skip(x));
        switch f {
          case FStatic(_.get() => c, _):
            emitStaticField(c, fieldName(f));
          case FEnum(_), FInstance(_), FAnon(_), FDynamic(_), FClosure(_):
            emitField(fieldName(f));
        }
      case TTypeExpr(t):
        if (isDirectImportLocal(t))
          write(baseTypeName(DependencyPlan.moduleTypeBase(t)));
        else
          write(ctx.typeAccessor(t));
      case TParenthesis(e1):
        write('(');
        emitValue(e1);
        write(')');
      case TMeta({name: name}, {expr: TFunction(f)}) if (name == ':jsAsync' || name == 'jsAsync'):
        final valueIifeDepth = this.valueIifeDepth;
        final inLoop = this.inLoop;
        this.valueIifeDepth = 0;
        this.inLoop = false;
        write('async function (');
        emitFunctionArguments(f);
        write(') ');
        emitFunctionBody(f);
        this.valueIifeDepth = valueIifeDepth;
        this.inLoop = inLoop;
      case TMeta({name: ':loopLabel', params: [{expr: EConst(CInt(n))}]}, e):
        switch (e.expr) {
          case TWhile(_, _, _), TFor(_, _, _):
            write('_hx_loop${n}: ');
            emitExpr(e);
          case TBreak:
            write('break _hx_loop${n}');
          case _: throw 'assert';
        }
      case TMeta(_, e):
        emitExpr(e);
      case TReturn(e):
        switch e {
          case null: write('return');
          case eo:
            emitPos(e.pos);
            write('return ');
            emitValueWithExpectedType(currentReturnType, eo);
        }
      case TBreak:
        if (!inLoop)
          throw 'Unsupported';
        write('break');
      case TContinue:
        if (!inLoop)
          throw 'Unsupported';
        write('continue');
      case TBlock(el):
        write('{');
        increaseIndent();
        for (e in el)
          emitBlockElement(e);
        decreaseIndent();
        writeNewline();
        write('}');
      case TFunction(f):
        final valueIifeDepth = this.valueIifeDepth;
        final inLoop = this.inLoop;
        this.valueIifeDepth = 0;
        this.inLoop = false;
        write('function (');
        emitFunctionArguments(f);
        write(') ');
        emitFunctionBody(f);
        this.valueIifeDepth = valueIifeDepth;
        this.inLoop = inLoop;
      case TCall({
        expr: TField(_,
          FStatic(_.get() => {module: 'js.Syntax'}, _.get() => {name: 'code'}))
      }, [{expr: TConst(TString("$global"))}]):
        write(ctx.typeAccessor(registerType));
        write(".$global");
      case TCall({
        expr: TField(_,
          FStatic(_.get() => {module: 'js.Syntax'}, _.get() => {name: 'code'}))
      }, args):
        if (!emitSyntaxCodeWithArgs(args))
          write(ctx.expr(e));
      case TCall({expr: TIdent('__js__')}, args):
        if (!emitLegacyJsIdentifier(args))
          write(ctx.expr(e));
      case TCall({
        expr: TField(_,
          FStatic(_.get() => {module: 'genes.Genes'},
            _.get() => {name: 'ignore'}))
      }, [names, body]):
        withDirectImportLocals(names, () -> emitExpr(body));
      case TCall(e, params):
        emitCall(e, params, false);
      case TArrayDecl(el):
        write('[');
        final elementType = arrayElementType(currentExpectedValueType) ?? arrayElementType(e.t);
        for (e in join(el, write.bind(', ')))
          emitValueWithExpectedType(elementType, e);
        write(']');
      case TThrow(e):
        write('throw ');
        emitValue(e);
      case TVar(v, eo):
        emitVar(v, eo);
      case TNew(c, _, el):
        write(switch (c.get().constructor) {
          case null:
            'new ';
          case _.get() => cf if (cf.meta.has(':selfCall')):
            '';
          default:
            'new ';
        });
        write(ctx.typeAccessor(TClassDecl(c)));
        write('(');
        for (e in join(el, write.bind(', ')))
          emitValue(e);
        write(')');
      case TIf(cond, e, eelse):
        write('if ');
        emitValue(cond);
        writeSpace();
        emitExpr(block(e));
        switch eelse {
          case null:
          case e2:
            emitPos(e2.pos);
            write(' else ');
            emitExpr(switch e2.expr {
              case TIf(_, _, _): e2;
              case _: block(e2);
            });
        }
      case TUnop(op, false, e):
        writeUnop(op);
        emitValue(e);
      case TUnop(op, true, e):
        emitValue(e);
        writeUnop(op);
      case TWhile(cond, e, true):
        final inLoop = this.inLoop;
        this.inLoop = true;
        write('while ');
        emitValue(cond);
        writeSpace();
        emitExpr(e);
        this.inLoop = inLoop;
      case TWhile(cond, e, false):
        final inLoop = this.inLoop;
        this.inLoop = true;
        write('do {');
        increaseIndent();
        writeNewline();
        emitExpr(e);
        decreaseIndent();
        writeNewline();
        write('} while ');
        emitValue(cond);
        this.inLoop = inLoop;
      case TObjectDecl(fields):
        write('{');
        final objectType = currentExpectedValueType != null ? currentExpectedValueType : e.t;
        for (field in join(fields, write.bind(', '))) {
          emitPos(field.expr.pos);
          emitString(anonymousFieldName(objectType, field.name));
          write(': ');
          emitValueWithExpectedType(anonymousFieldType(objectType, field.name),
            field.expr);
        }
        write('}');
      case TFor(_, _, _):
        final inLoop = this.inLoop;
        this.inLoop = true;
        final lowered = requireTempPlan().loweredFor(e);
        final iteratorName = switch lowered.iterator {
          case ExistingIterator(local):
            localName(local);
          case TemporaryIterator(temp):
            write('$declare ${getLocalIdent(temp.name)} = ');
            emitValue(temp.initializer);
            writeNewline();
            getLocalIdent(temp.name);
        };
        write('while (');
        write(iteratorName);
        write('.hasNext()) {');
        increaseIndent();
        writeNewline();
        write('$declare ');
        emitLocalVar(lowered.variable);
        write(' = ');
        write(iteratorName);
        write('.next()');
        writeNewline();
        emitBlockElement(lowered.body);
        decreaseIndent();
        writeNewline();
        write('}');
        this.inLoop = inLoop;
      case TTry(etry, [{v: v, expr: ecatch}]):
        write('try ');
        emitExpr(etry);
        write('catch (');
        emitLocalVar(v);
        write(') ');
        emitExpr(ecatch);
      case TTry(_):
        throw 'Unhandled try/catch, please report';
      case TSwitch(cond, cases, def):
        emitSwitch(cond, cases, def, e -> emitBlockElement(e));
      case TCast(e, null):
        emitExpr(e);
      case TCast(e1, t):
        write(ctx.typeAccessor(bootType));
        write('.__cast(');
        emitValue(e1);
        write(', ');
        write(ctx.typeAccessor(t));
        write(')');
      case TIdent("$hxEnums"):
        writeGlobalVar("$hxEnums");
      case TIdent("$hxClasses"):
        writeGlobalVar("$hxClasses");
      case TIdent(s):
        write(s);
      default:
    }
  }

  function emitFunctionArguments(f: TFunc) {
    for (arg in join(f.args, write.bind(', '))) {
      if (isRest(arg.v.t))
        write('...');
      emitLocalVar(arg.v);

      /* see getFunctionBody() and https://github.com/benmerckx/genes/issues/54 */
      // if (arg.value != null) {
      //   write(' = ');
      //   emitValue(arg.value);
      // }
    }
  }

  function emitCall(e: TypedExpr, params: Array<TypedExpr>, inValue: Bool) {
    if (emitPlannedTemplateLiteralCall(e, params))
      return;
    if (emitPlannedJsxCall(e, params))
      return;
    emitPos(e.pos);
    switch [e.expr, params] {
      case [TIdent('`trace'), [e, info]]:
        write('console.log(');
        switch info.expr {
          case TObjectDecl(posInfo(_) => info) if (info != null):
            write('"${info.file}:${info.line}:",');
          default:
        }
        emitValue(e);
        write(')');
      case [TCall(x, _), el] if (switch (x.expr) {
          case TIdent('__js__'): false;
          case _: true;
        }):
        write('(');
        emitValue(e);
        write(')(');
        for (e in join(el, write.bind(', ')))
          emitValue(e);
        write(')');
      case [
        TField(_,
          FStatic(_.get() => {module: 'js.Syntax'}, _.get() => {name: name})),
        args
      ]:
        emitSyntax(name, args);
      case [TIdent("__resources__"), args]:
        write(ctx.value({expr: TCall(e, params), pos: e.pos, t: e.t}));
      case [TIdent("__new__"), args]:
        emitSyntax("new_", args);
      case [TIdent("__instanceof__"), args]:
        emitSyntax("instanceof", args);
      case [TIdent("__typeof__"), args]:
        emitSyntax("typeof", args);
      case [TIdent("__strict_eq__"), args]:
        emitSyntax("strictEq", args);
      case [TIdent("__strict_neq__"), args]:
        emitSyntax("strictNeq", args);
      case [TIdent('__define_feature__'), [_, e]]:
        emitExpr(e);
      case [TIdent('__feature__'), [{expr: TConst(TString(f))}, eif]]:
        if (ctx.hasFeature(f))
          emitValue(eif);
      case [TIdent('__feature__'), [{expr: TConst(TString(f))}, eif, eelse]]:
        if (ctx.hasFeature(f))
          emitValue(eif)
        else
          emitValue(eelse);
      case [TField(x, f), []]
        if (fieldName(f) == "iterator" && isDynamicIterator(x)):
        ctx.addFeature("use.$getIterator");
        write(ctx.typeAccessor(registerType));
        write('.getIterator(');
        emitValue(x);
        write(')');
      case [TConst(TSuper), args]:
        switch extendsExtern {
          case Some(t):
            write(ctx.typeAccessor(t));
            write(args.length > 0 ? '.call(this, ' : '.call(this');
          case None:
            write('super[');
            write(ctx.typeAccessor(registerType));
            write('.new](');
        }
        for (param in join(args, write.bind(', ')))
          emitValue(param);
        write(')');
      default:
        emitValue(e);
        write('(');
        emitCallParams(e, params);
        write(')');
    }
  }

  /**
   * Routes only the exact compiler marker through shared template semantics.
   *
   * Why/What: ordinary string concatenation must keep its historical spelling;
   * a validated marker alone opts into the stronger template contract. Returning
   * `false` leaves every unrelated call on the existing emitter path.
   *
   * How: `TemplateLiteralPlan` owns identity and carrier validation. This method
   * chooses no syntax itself, so the classic and TypeScript emitters consume the
   * same ordered chunks and values without re-parsing target text.
   */
  function emitPlannedTemplateLiteralCall(callee:TypedExpr,
      arguments:Array<TypedExpr>):Bool {
    if (templateLiteralPlan == null)
      return false;
    final intent = templateLiteralPlan.intentForCall(callee, arguments);
    if (intent == null)
      return false;
    emitTemplateLiteralIntent(intent);
    return true;
  }

  /**
   * Emits the classic-JS spelling for target-neutral string-template intent.
   *
   * Why: classic output cannot rely on TypeScript's contextual template-literal
   * inference, but it must execute the same values in the same order.
   *
   * What/How: a static template stays a string literal; a dynamic template is
   * parenthesized concatenation beginning with a literal chunk. Each slot is
   * also parenthesized so an embedded operator cannot reassociate with the
   * surrounding `+` chain. Interpolations are already typed as `String`, are
   * printed once, and temporarily use their own expected type so an outer
   * destination cannot alter nested emission.
   */
  function emitTemplateLiteralIntent(intent:TemplateLiteralIntent):Void {
    emitPos(intent.pos);
    if (intent.values.length == 0) {
      emitString(intent.chunks[0]);
      return;
    }
    write('(');
    emitString(intent.chunks[0]);
    for (index in 0...intent.values.length) {
      write(' + (');
      final value = intent.values[index];
      emitValueWithExpectedType(value.t, value);
      write(') + ');
      emitString(intent.chunks[index + 1]);
    }
    write(')');
  }

  /** Emits one marker call through the shared semantic plan when applicable. */
  function emitPlannedJsxCall(callee: TypedExpr,
      arguments: Array<TypedExpr>): Bool {
    if (jsxPlan == null)
      return false;
    final intent = jsxPlan.intentForCall(callee, arguments);
    if (intent == null)
      return false;
    emitJsxIntent(intent);
    return true;
  }

  /**
   * JavaScript lowering for target-neutral JSX intent.
   *
   * `.jsx` keeps source markup after Haxe types are erased. Classic `.js` and
   * plain `.ts` use the same React-compatible runtime contract. The TypeScript
   * emitter reuses the source-markup methods for `.tsx`, so syntax behavior
   * cannot drift between the two JSX-preserving profiles.
   */
  function emitJsxIntent(intent: JsxIntent): Void {
    if (jsxEmissionProfile == JavaScriptJsxAutomatic) {
      switch intent {
        case ElementIntent(tag, props, children, pos):
          emitPos(pos);
          emitJsxSourceElement(tag, props, children);
        case FragmentIntent(children, pos):
          emitPos(pos);
          emitJsxSourceFragment(children);
      }
      return;
    }
    final runtime = requireJsxRuntimeBinding(intent);
    switch intent {
      case ElementIntent(tag, props, children, pos):
        emitPos(pos);
        write(runtime);
        write('.createElement(');
        emitValue(JsxPlan.tagExpression(tag));
        write(', ');
        emitClassicJsxProps(props);
        for (child in children) {
          write(', ');
          emitJsxChildValue(child);
        }
        write(')');
      case FragmentIntent(children, pos):
        emitPos(pos);
        write(runtime);
        write('.createElement(');
        write(runtime);
        write('.Fragment, null');
        for (child in children) {
          write(', ');
          emitJsxChildValue(child);
        }
        write(')');
    }
  }

  /** Shared syntax printer for type-preserving TSX and type-erased JSX. */
  function emitJsxSourceFragment(children: Array<JsxChildIntent>): Void {
    write('<>');
    emitJsxSourceChildren(children);
    write('</>');
  }

  /** Shared syntax printer for type-preserving TSX and type-erased JSX. */
  function emitJsxSourceElement(tag: JsxTagIntent,
      props: Array<JsxPropIntent>, children: Array<JsxChildIntent>): Void {
    switch tag {
      case DynamicIntrinsicTag(_):
        emitJsxDynamicIntrinsicElement(tag, props, children);
        return;
      default:
    }
    write('<');
    emitJsxSourceTagName(tag);
    emitJsxSourceAttributes(props);
    if (children.length == 0) {
      write(' />');
      return;
    }
    write('>');
    emitJsxSourceChildren(children);
    write('</');
    emitJsxSourceTagName(tag);
    write('>');
  }

  function emitJsxDynamicIntrinsicElement(tag: JsxTagIntent,
      props: Array<JsxPropIntent>, children: Array<JsxChildIntent>): Void {
    final runtime = jsxRuntimeBinding;
    if (runtime == null)
      CompilerDiagnostic.fail('[GTS-JSX-CAPABILITY-005] Dynamic intrinsic '
        + 'tag has no planned JSX runtime namespace.',
        JsxPlan.tagExpression(tag).pos);
    write(runtime);
    write('.createElement(');
    emitValue(JsxPlan.tagExpression(tag));
    write(', ');
    emitClassicJsxProps(props);
    for (child in children) {
      write(', ');
      emitJsxChildValue(child);
    }
    write(')');
  }

  function emitJsxSourceTagName(tag: JsxTagIntent): Void {
    switch tag {
      case IntrinsicTag(name, _):
        write(name);
      case ComponentTag(expression):
        emitValue(expression);
      case DynamicIntrinsicTag(expression):
        CompilerDiagnostic.fail('[GTS-JSX-CAPABILITY-006] Dynamic intrinsic '
          + 'tag reached JSX tag-name printing instead of createElement.',
          expression.pos);
    }
  }

  function emitJsxSourceAttributes(props: Array<JsxPropIntent>): Void {
    for (prop in props) {
      switch prop {
        case SpreadProp(expression, source):
          write(' {...');
          emitJsxValue(expression, source);
          write('}');
        case NamedProp(name, value, source):
          write(' ');
          write(name);
          switch [source, JsxPlan.unwrap(value).expr] {
            case [DirectValue, TConst(TBool(true))]:
              // JSX boolean shorthand.
            case [DirectValue, TConst(TString(text))]:
              write('=');
              emitString(text);
            default:
              write('={');
              emitJsxValue(value, source);
              write('}');
          }
      }
    }
  }

  function emitJsxSourceChildren(children: Array<JsxChildIntent>): Void {
    for (child in children) {
      switch child {
        case ChildIntent(expression, source):
          final emittedExpression = source.match(DirectValue)
            ? sourceInlineJsxValue(expression)
            : expression;
          if (source.match(DirectValue)
            && JsxPlan.isMarkerCallExpression(emittedExpression)) {
            emitValue(emittedExpression);
            continue;
          }
          switch [source, JsxPlan.unwrap(expression).expr] {
            case [DirectValue, TConst(TString(value))]:
              write(value);
            default:
              write('{');
              emitJsxValue(expression, source);
              write('}');
          }
      }
    }
  }

  function emitClassicJsxProps(props: Array<JsxPropIntent>): Void {
    if (props.length == 0) {
      write('null');
      return;
    }
    write('{');
    for (prop in join(props, write.bind(', '))) {
      switch prop {
        case NamedProp(name, value, source):
          emitString(name);
          write(': ');
          emitJsxValue(value, source);
        case SpreadProp(expression, source):
          write('...');
          emitJsxValue(expression, source);
      }
    }
    write('}');
  }

  function emitJsxChildValue(child: JsxChildIntent): Void {
    switch child {
      case ChildIntent(expression, source):
        emitJsxValue(expression, source);
    }
  }

  /** Emits an expression once, or reads the local path that already holds it. */
  function emitJsxValue(expression: TypedExpr, source: JsxValueSource): Void {
    switch source {
      case DirectValue:
        emitValue(sourceInlineJsxValue(expression));
      case RuntimeValuePath(root, path):
        emitValue(root);
        for (access in path) {
          switch access {
            case JsxObjectField(name):
              emitField(name);
          }
        }
    }
  }

  function requireJsxRuntimeBinding(intent: JsxIntent): String {
    if (jsxRuntimeBinding != null)
      return jsxRuntimeBinding;
    final pos = switch intent {
      case ElementIntent(_, _, _, found) | FragmentIntent(_, found): found;
    }
    return CompilerDiagnostic.fail(
      '[GTS-JSX-CAPABILITY-004] JSX intent reached the expression '
      + 'printer without a runtime namespace. This is a compiler planning error.',
      pos);
  }

  /**
   * Emits call arguments with their typed function-parameter context.
   *
   * Why: object literals passed directly to functions or methods can need the
   * destination parameter type to preserve anonymous-field metadata such as
   * `@:native("...")`. A common example is `Array<T>.push({ ... })`, where the
   * literal should be emitted as a `T` even though its own inferred anonymous
   * type no longer carries the target typedef metadata.
   *
   * How: use the callee's typed `TFun` signature as contextual emission state
   * for each argument. This does not cast or retype the expression; it only
   * gives object-literal emission access to the destination field contracts.
   */
  function emitCallParams(callee: TypedExpr, params: Array<TypedExpr>) {
    final expected = callParamTypes(callee);
    for (i in 0...params.length) {
      if (i > 0)
        write(', ');
      final expectedType = i < expected.length ? expected[i] : null;
      emitValueWithExpectedType(expectedType, params[i]);
    }
  }

  function callParamTypes(callee: TypedExpr): Array<Type> {
    return switch Context.follow(callee.t) {
      case TFun(args, _):
        [for (arg in args) arg.t];
      case TLazy(f):
        callParamTypes(with(callee, null, f()));
      default:
        [];
    }
  }

  function emitSyntax(method: String, args: Array<TypedExpr>)
    switch method {
      case 'construct':
        write('new ');
        emitValue(args[0]);
        write('(');
        for (arg in join(args.slice(1), write.bind(', ')))
          emitValue(arg);
        write(')');
      case 'instanceof':
        write('((');
        emitValue(args[0]);
        write(') instanceof ');
        emitValue(args[1]);
        write(')');
      case 'typeof':
        write('typeof(');
        emitValue(args[0]);
        write(')');
      case 'strictEq':
        write('((');
        emitValue(args[0]);
        write(') === (');
        emitValue(args[1]);
        write('))');
      case 'strictNeq':
        write('((');
        emitValue(args[0]);
        write(') !== (');
        emitValue(args[1]);
        write('))');
      case 'delete':
        write('delete(');
        emitValue(args[0]);
        write('[');
        emitValue(args[1]);
        write('])');
      case 'field':
        emitValue(args[0]);
        write('[');
        emitValue(args[1]);
        write('])');
      default:
        throw 'Unknown js.Syntax method "$method"';
    }

  function asValue(expression: TypedExpr,
      assigner: (assign: TypedExpr->Void)->Void) {
    final result = requireTempPlan().loweredValue(expression).result;
    final valueIifeDepth = this.valueIifeDepth;
    final inLoop = this.inLoop;
    this.valueIifeDepth++;
    this.inLoop = false;
    function assign(e: TypedExpr) {
      write('${result.name} = ');
      emitValue(e);
    }
    write("(function($this) {");
    increaseIndent();
    write('var ${result.name}');
    writeNewline();
    assigner(assign);
    writeNewline();
    write('return ${result.name}');
    decreaseIndent();
    write('})');
    this.valueIifeDepth = valueIifeDepth;
    this.inLoop = inLoop;
    write('(');
    emitThis();
    write(')');
  }

  function emitValue(e: TypedExpr):Void {
    if (CompilerInternal.isSideEffectImportMarkerCall(e)) {
      CompilerDiagnostic.fail(
        'GENES-SIDE-EFFECT-IMPORT-CONTEXT-001: compiler marker must be a direct statement',
        e.pos);
      return;
    }
    emitPos(e.pos);
    switch e.expr {
      case TMeta(_, e1):
        emitValue(e1);
      case TCall({
        expr: TField(_,
          FStatic(_.get() => {module: 'js.Syntax'}, _.get() => {name: 'code'}))
      }, args):
        if (!emitSyntaxCodeWithArgs(args))
          write(ctx.value(e));
      case TCall({expr: TIdent('__js__')}, args):
        if (!emitLegacyJsIdentifier(args))
          write(ctx.value(e));
      case TCall({
        expr: TField(_,
          FStatic(_.get() => {module: 'genes.Genes'},
            _.get() => {name: 'ignore'}))
      }, [names, body]):
        withDirectImportLocals(names, () -> emitValue(body));
      case TCall(callee, params)
        if (Context.defined('genes.ts') && params.length == 0 && switch callee.expr {
          case TField(_, f): (fieldName(f) == "pop" || fieldName(f) == "shift");
          default: false;
        }):
        // In TS mode, normalize JS `undefined` to Haxe `null` for Array#pop/#shift.
        write('(');
        emitCall(callee, params, true);
        write(' ?? null)');
      case TCall(e, params):
        emitCall(e, params, true);
      case TReturn(_) | TBreak | TContinue:
        throw 'Unsupported $e';
      case TCast(e1, null):
        emitValue(e1);
      /*case TCast(e1, t):
        print(ctx, '${ctx.type_accessor(TClassDecl(core.Type.null_class.with({cl_path:{a:["js"], b:"Boot"}})))}.__cast(');
        gen_value(ctx, e1);
        spr(ctx, " , ");
        spr(ctx, (ctx.type_accessor(t)));
        spr(ctx, ")"); */
      case TVar(_), TFor(_, _, _), TWhile(_, _, _), TThrow(_):
        asValue(e, assign -> assign(e));
      case TBlock([]): // Todo: hm?
        write('null');
      case TBlock([e]):
        emitValue(e);
      case TBlock(el):
        asValue(e, assign -> {
          for (element in el.slice(0, el.length - 1)) {
            emitExpr(element);
            write(';');
            writeNewline();
          }
          assign(el[el.length - 1]);
        });
      case TIf(cond, e, eo):
        final expected = currentExpectedValueType;
        emitValue(cond);
        write(' ? ');
        emitValueWithExpectedType(expected, e);
        write(' : ');
        switch eo {
          case null:
            write('null');
          case e:
            emitValueWithExpectedType(expected, e);
        }
      case TSwitch(cond, cases, def):
        asValue(e, assign -> {
          emitSwitch(cond, cases, def, assign, false);
        });
      case TTry(etry, [{v: v, expr: ecatch}]):
        asValue(e, assign -> {
          write('try {');
          assign(block(etry));
          write('} catch (');
          emitLocalVar(v);
          write(') {');
          assign(block(ecatch));
          write(') {');
        });
      default:
        emitExpr(e);
    }
  }

  /**
   * Emits a value with the type expected by its destination.
   *
   * Why: anonymous object literals can lose declaration metadata on their own
   * typed expression, while the destination type still knows field contracts
   * such as `@:native("...")`. Threading expected type context lets both JS and
   * TS emitters preserve external property names for local initializers,
   * assignments, nested object fields, conditional-expression branches, and
   * returns.
   *
   * How: this is only contextual emission state. It does not cast or retag the
   * Haxe expression; callees may consult `currentExpectedValueType` when they
   * need destination metadata that is absent from `expr.t`.
   */
  function emitValueWithExpectedType(expected: Null<Type>, expr: TypedExpr) {
    final previous = currentExpectedValueType;
    currentExpectedValueType = expected;
    emitValue(expr);
    currentExpectedValueType = previous;
  }

  function emitFunctionBody(f: TFunc) {
    final previous = currentReturnType;
    currentReturnType = f.t;
    emitExpr(getFunctionBody(f));
    currentReturnType = previous;
  }

  function emitSwitch(cond: TypedExpr,
      cases: Array<{values: Array<TypedExpr>, expr: TypedExpr}>,
      def: Null<TypedExpr>, leaf: TypedExpr->Void,
      ?leafStartsWithNewline: Bool = true) {
    write('switch ');
    emitValue(cond);
    write(' {');
    increaseIndent();
    writeNewline();
    var hasClause = false;
    // Insert separators before later clauses. Emitting one after every clause
    // would eagerly indent a blank line before the switch's closing brace.
    function startClause() {
      if (hasClause)
        writeNewline();
      hasClause = true;
    }
    for (c in cases) {
      startClause();
      emitPos(c.expr.pos);
      for (v in c.values) {
        emitPos(v.pos);
        switch v.expr {
          case TConst(TNull):
            write('case null: case undefined:');
          default:
            write('case ');
            emitValue(v);
            write(':');
        }
      }
      increaseIndent();
      leaf(c.expr);
      writeNewline();
      write('break'); // Todo: implement needs_switch_break
      decreaseIndent();
    }
    switch def {
      case null:
      case e:
        startClause();
        emitPos(e.pos);
        write('default:');
        leaf(e);
    }
    decreaseIndent();
    writeNewline();
    write('}');
  }

  public function emitConstant(c: TConstant)
    switch (c) {
      case TInt(i):
        write('${i}');
      case TFloat(s):
        write('${s}');
      case TString(s):
        emitString(s);
      case TBool(b):
        write(if (b) 'true' else 'false');
      case TNull:
        write('null');
      case TThis:
        emitThis();
      case TSuper:
        write('super');
    }

  function emitThis() {
    if (valueIifeDepth == 0)
      write('this')
    else
      write("$this");
  }

  function emitBlockElement(e: TypedExpr, after = false) {
    if (CompilerInternal.isSideEffectImportMarkerCall(e))
      return;
    if (skipsSourceInlineJsxDeclaration(e))
      return;
    emitPos(e.pos);
    switch e.expr {
      case TBlock(el):
        for (e in el)
          emitBlockElement(e, after);
      case TCall({expr: TIdent('__feature__')},
        [{expr: TConst(TString(f))}, eif]):
        if (ctx.hasFeature(f))
          emitBlockElement(eif, after);
      case TCall({expr: TIdent('__feature__')},
        [{expr: TConst(TString(f))}, eif, eelse]):
        if (ctx.hasFeature(f))
          emitBlockElement(eif, after)
        else
          emitBlockElement(eelse, after);
      case TFunction(_):
        emitBlockElement(with(e, TParenthesis(e)), after);
      case TObjectDecl(fl):
        for (field in fl)
          emitBlockElement(field.expr, after);
      case _:
        if (!after)
          writeNewline();
        emitExpr(e);
        write(';');
        if (after)
          writeNewline();
    }
  }

  function emitString(input: String) {
    writeQuotes();
    for (char in input)
      write(switch char {
        case '\n'.code: "\\n";
        case '\t'.code: "\\t";
        case '\r'.code: "\\r";
        case '"'.code: "\\\"";
        case '\\'.code: "\\\\";
        case code:
          if (code < 32) "\\x"
            + StringTools.hex(code, 2) else String.fromCharCode(code);
      });
    writeQuotes();
  }

  function emitFieldName(f: FieldAccess) {
    write(fieldName(f));
  }

  /**
   * Emits a field-level package binding from its exact typed owner.
   *
   * Import form, exported root, and dotted member suffix were normalized by
   * dependency planning. Re-reading metadata here would lose the collision-safe
   * local and could choose another same-named export, so this emitter performs
   * only an origin lookup and prints the resolved accessor.
   */
  function emitJsRequireField(owner: haxe.macro.Type.ClassType,
      field: haxe.macro.Type.ClassField) {
    write(ctx.typeAccessor(TypeAccessor.forStaticField(owner, field)));
  }

  function transformIdent(name: String) {
    return if (keywords.exists(name)) "$" + name; else name;
  }

  function emitIdent(name: String) {
    write(transformIdent(name));
  }

  function emitLocalIdent(name: String) {
    write(getLocalIdent(name));
  }

  /** Returns the escaped spelling selected before source emission begins. */
  function localName(local: TVar): String {
    final raw = requireNamePlan().nameFor(local);
    return getLocalIdent(raw);
  }

  /** Emits a typed local by stable `TVar.id`, never by encounter-order text. */
  function emitLocalVar(local: TVar): Void {
    write(localName(local));
  }

  function requireTempPlan(): TempPlan {
    if (tempPlan != null)
      return tempPlan;
    throw '[GTS-TEMP-PLAN-002] Expression emission began before configureLowering.';
  }

  function requireNamePlan(): NamePlan {
    if (namePlan != null)
      return namePlan;
    throw '[GTS-NAME-PLAN-002] Expression emission began before configureLowering.';
  }

  function emitStaticField(c: ClassType, s: String)
    return switch s {
      case 'length' | 'name' if (!c.isExtern || c.meta.has(':hxGen')):
        write(".$" + s);
      case s: emitField(s);
    }

  function emitField(name: String) {
    if (isComputedMemberName(name))
      write(name)
    else if (keywords.exists(name))
      write('["${name}"]')
    else
      write('.${name}');
  }

  public function emitMemberName(name: String) {
    if (isComputedMemberName(name))
      write(name);
    else if (keywords.exists(name))
      write('["${name}"]');
    else
      write(name);
  }

  static function isComputedMemberName(name: String): Bool {
    return StringTools.startsWith(name, "[") && StringTools.endsWith(name, "]");
  }

  function simpleBindReceiver(e: TypedExpr): TypedExpr {
    return switch e.expr {
      case TMeta(_, e1) | TParenthesis(e1) | TCast(e1, null):
        simpleBindReceiver(e1);
      case _:
        e;
    }
  }

  public function emitVar(v: TVar, eo: Null<TypedExpr>) {
    write('$declare ');
    emitLocalVar(v);
    switch (eo) {
      case null:
      case e:
        write(' = ');
        emitValueWithExpectedType(v.t, e);
    }
  }

  /**
   * Emits one conventional JSDoc block without whitespace-only lines.
   *
   * Why: downstream formatters and bundlers indent empty comment lines, which
   * turns a visually blank hxdoc line into trailing whitespace even when the
   * direct Genes output was clean. What/How: every content line carries the
   * standard visible ` *` prefix. A block whose source lines all carry the
   * conventional leading `*` is normalized before that prefix is added. Empty
   * hxdoc lines therefore remain explicit comment lines, and generated source
   * reads like ordinary handwritten JS/TS.
   */
  public function emitComment(text: Null<String>) {
    if (text == null)
      return;
    final comment = text.trim();
    final lines = comment.split('\n');
    var usesSourceStarLeaders = false;
    var allContentUsesStarLeaders = true;
    for (line in lines) {
      final content = line.trim();
      if (content.length > 0) {
        usesSourceStarLeaders = true;
        if (content.charAt(0) != '*')
          allContentUsesStarLeaders = false;
      }
    }
    usesSourceStarLeaders = usesSourceStarLeaders && allContentUsesStarLeaders;
    write('/**\n');
    for (line in lines) {
      var content = line.trim();
      if (usesSourceStarLeaders && content.charAt(0) == '*') {
        content = content.substr(1);
        if (content.charAt(0) == ' ')
          content = content.substr(1);
      }
      for (i in 0...indent)
        write('\t');
      write(' *');
      if (content.length > 0)
        write(' ' + content);
      write('\n');
    }
    for (i in 0...indent)
      write('\t');
    write(' */');
    writeNewline();
  }

  public function writeUnop(op: Unop)
    write(switch (op) {
      case OpIncrement: "++";
      case OpDecrement: "--";
      case OpNot: "!";
      case OpNeg: "-";
      case OpNegBits: "~";
      #if (haxe_ver >= 4.2)
      case OpSpread: "...";
      #end
    });

  public function writeBinop(op: Binop)
    write(switch (op) {
      case OpAdd: '+';
      case OpMult: '*';
      case OpDiv: '/';
      case OpSub: '-';
      case OpAssign: '=';
      case OpEq: '==';
      case OpNotEq: '!=';
      case OpGte: '>=';
      case OpLte: '<=';
      case OpGt: '>';
      case OpLt: '<';
      case OpAnd: '&';
      case OpOr: '|';
      case OpXor: '^';
      case OpBoolAnd: '&&';
      case OpBoolOr: '||';
      case OpShr: '>>';
      case OpUShr: '>>>';
      case OpShl: '<<';
      case OpMod: '%';
      case OpAssignOp(op):
        writeBinop(op);
        '=';
      case OpInterval: '...';
      case OpArrow: '=>';
      case OpIn: ' in ';
      #if (haxe_ver >= 4.3)
      case OpNullCoal: '??';
      #end
    });

  public function writeNewline() {
    write('\n');
    for (i in 0...indent)
      write('\t');
  }

  /**
   * Starts a member line and inserts one clean separator for documentation.
   *
   * Why: two consecutive ordinary newline calls eagerly indent the empty line,
   * leaving invisible trailing tabs before documented members. What/How: the
   * separator is emitted as part of the newline sequence before indentation,
   * preserving source-map columns on the actual member line.
   */
  public function writeMemberNewline(hasDocumentation: Bool) {
    write(hasDocumentation ? '\n\n' : '\n');
    for (i in 0...indent)
      write('\t');
  }

  function writeSpace()
    write(' ');

  function writeQuotes()
    write('"');

  function writeKeyword(keyword: String)
    write(keyword);

  function writeGlobalVar(name) {
    write(ctx.typeAccessor(registerType));
    switch (name) {
      case "$hxEnums":
        write(".hxEnums()");
      case "$hxClasses":
        write(".hxClasses()");
      default:
        write('.global(');
        emitString(name);
        write(')');
    }
  }

  static function typeAllowsNull(t: Type): Bool {
    return NullishContract.forType(t).haxeAllowsNull;
  }

  // Utilities

  public function increaseIndent()
    indent++;

  public function decreaseIndent()
    indent--;

  // ref: https://github.com/HaxeFoundation/haxe/blob/6eb36b2aa38591203005ea30f8334e41de292111/src/core/texpr.ml#L542-L546
  function getFunctionBody(f: TFunc) {
    return with(f.expr, switch f.expr {
      case {expr: TBlock(body)}:
        // insert a `if(arg == null) arg = value` for each arg with default value
        TBlock([
          for (arg in f.args)
            switch arg.value {
              case null | {expr: TConst(TNull)}:
                continue;
              case value:
                final ident = with(value, TIdent(localName(arg.v)));
                {
                  t: value.t,
                  pos: value.pos,
                  expr: TIf(with(value,
                    TParenthesis(with(value,
                      TBinop(OpEq, ident, with(value, TConst(TNull)))))),
                    with(value, TBinop(OpAssign, ident, value)), null),
                }
            }
        ].concat(body));
      case _: throw 'expected function body to be TBlock';
    });
  }

  function getLocalIdent(name: String) {
    return keywords.exists(name)
      || keywordsLocal.exists(name) ? '$$$name' : name;
  }
}
