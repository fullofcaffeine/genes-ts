package genes.dts;

import genes.es.ModuleEmitter;
import haxe.macro.Type;
import genes.Module;
import genes.util.TypeUtil;
import genes.util.IteratorUtil.*;
import genes.dts.TypeEmitter;
import genes.util.Timer.timer;
import genes.PublicSurface;
import genes.NullishContract;
import genes.StdTypesSupport;
import genes.JsonTypeSupport;

class DefinitionEmitter extends ModuleEmitter {
  public function emitDefinition(module: Module) {
    final dependencies = module.declarationDependencies;
    final endTimer = timer('emitDefinition');
    ctx.typeAccessor = dependencies.typeAccessor;
    if (haxe.macro.Context.defined('genes.dts_banner')) {
      write(haxe.macro.Context.definedValue('genes.dts_banner'));
      writeNewline();
    }
    for (path => imports in dependencies.imports)
      emitImports(if (imports[0].external) path else module.toPath(path),
        imports, Genes.outExtension);
    // `genes.ts.Json*` helpers erase at runtime but their strong declaration
    // projection names one recursive alias family. Emit it in classic `.d.ts`
    // modules from the same semantic plan consumed by TS source output.
    if (JsonTypeSupport.moduleUsesJsonTypes(module)
      || JsonTypeSupport.dependenciesUseJsonTypes(dependencies)) {
      writeNewline();
      JsonTypeSupport.emitAliases(line -> {
        write(line);
        writeNewline();
      });
    }
    for (member in module.members) {
      // Dependency planning uses this same projection, so skipping an internal
      // member cannot leave a declaration import with no printed consumer.
      if (!Module.memberProjection(member).emitDeclaration)
        continue;
      switch member {
        #if (haxe_ver >= 4.2)
        case MClass(cl = {kind: KModuleFields(_)}, _, fields):
          emitModuleStatics(cl, Module.emittableFields(fields));
        #end
        case MClass(cl, params, fields):
          // Interface contracts are type-only and consume the complete shared
          // surface. Class declarations intersect it with emitted runtime
          // members: promising a DCE-stripped method in `.d.ts` would be
          // unsound even though DependencyPlan could retain its parameter types.
          // Private runtime fields never enter the consumer declaration.
          final publicSurface = PublicSurface.forClass(cl);
          emitClassDefinition(cl, publicSurface, params,
            Module.fieldsOf(cl, publicSurface, params, false,
              cl.isInterface ? null : Module.emittableFields(fields)));
        case MEnum(et, params):
          emitEnumDefinition(et, params);
        case MType(def, params):
          emitTypeDefinition(def, params);
        default:
      }
    }
    for (export in module.expose)
      emitExport(export, module.toPath(export.module), Genes.outExtension);
    // Haxe's structural StdTypes module is the one declaration artifact every
    // full classic output tree owns. Append shared host-library gaps here so
    // classic `.d.ts` and TS-source output consume the same WebIDL contract.
    if (module.module == 'StdTypes')
      StdTypesSupport.emitClassicGlobalBlock(writer);
    endTimer();
  }

  function emitTypeDefinition(def: DefType, params: Array<Type>) {
    writeNewline();
    emitComment(def.doc);
    emitPos(def.pos);
    write('export type ');
    emitDeclarationBaseType(def, params, true);
    write(' = ');
    final typeOverride = switch def.meta.extract(':ts.type') {
      case [{params: [{expr: EConst(CString(type))}]}]: type;
      default:
        switch def.meta.extract(':genes.type') {
          case [{params: [{expr: EConst(CString(type))}]}]: type;
          default: null;
        }
    };
    if (typeOverride != null)
      write(typeOverride);
    else
      emitType(PublicSurface.forTypedef(def).aliasTypeFor(params));
    writeNewline();
  }

  function emitEnumDefinition(et: EnumType, params: Array<Type>) {
    final id = et.pack.concat([et.name]).join('.');
    writeNewline();
    emitComment(et.doc);
    emitPos(et.pos);
    write('export declare namespace ');
    write(et.name);
    write(' {');
    increaseIndent();
    for (name => c in et.constructs) {
      writeNewline();
      emitPos(c.pos);
      write('export type ');
      write(name);
      emitEnumConstructorTypeParams(params, c.params.map(param -> param.t));
      write(' = {');
      final discriminator = haxe.macro.Context.definedValue('genes.enum_discriminator');
      if (discriminator != null) {
        emitString(discriminator);
        write(': ');
        emitString(name);
        write(', ');
      }
      write('_hx_index: ${c.index}');
      switch c.type {
        case TFun(args, ret):
          for (arg in args) {
            write(', ');
            emitIdent(arg.name);
            write(': ');
            emitType(arg.t);
          }
        default:
      }
      write(', __enum__: "${id}"}');
      writeNewline();
      write('export const ');
      write(name);
      write(': ');
      switch c.type {
        case TFun(args, ret):
          final allParams = params.concat(c.params.map(p -> p.t));
          emitParams(allParams, true);
          write('(');
          for (arg in join(args, write.bind(', '))) {
            emitIdent(arg.name);
            write(': ');
            emitType(arg.t);
          }
          write(') => ');
          emitType(ret);
        case TEnum(_, params):
          write(name);
          if (params.length > 0) {
            write('<');
            for (param in join(params, write.bind(', ')))
              switch param {
                case TInst(_.get() => {
                  name: name,
                  kind: KTypeParameter([])
                }, []):
                  // A nullary constructor has no payload from which TypeScript
                  // could infer this enum parameter. `never` is the sound
                  // bottom type: it stays assignable to every structural
                  // instantiation without leaking `any` into the public
                  // declaration. Keep this aligned with emitTsEnum.
                  write('never');
                default:
                  emitType(param);
              }
            write('>');
          }
        default:
      }
    }
    decreaseIndent();
    writeNewline();
    write('}');
    writeNewline();
    writeNewline();
    emitComment(et.doc);
    write('export declare type ');
    emitDeclarationBaseType(et, params, true);
    // Each union member starts on its own line. Keep the assignment readable
    // without leaving a trailing space on the preceding declaration line.
    write(' =');
    increaseIndent();
    for (name => c in et.constructs) {
      writeNewline();
      emitComment(c.doc);
      write('| ');
      write(et.name);
      write('.');
      emitPos(c.pos);
      write(name);
      emitParams(params);
    }
    decreaseIndent();
    writeNewline();
  }

  function emitModuleStatics(cl: ClassType, fields: Array<Field>) {
    writeNewline();
    emitPos(cl.pos);
    for (field in fields)
      switch field {
        case {isStatic: true, isPublic: true}:
          emitPos(field.pos);
          write('export const ');
          emitIdent(TypeUtil.nativeName(field.meta) ?? field.name);
          write(': ');
          if (field.tsType != null)
            write(field.tsType);
          else
            emitType(field.type, field.params);
          writeNewline();
        default:
      }
  }

  function emitClassDefinition(cl: ClassType, publicSurface: PublicSurface,
      params: Array<Type>, fields: Array<Field>) {
    writeNewline();
    emitComment(cl.doc);
    emitPos(cl.pos);
    write('export declare ');
    write(if (cl.isInterface) 'interface' else 'class');
    writeSpace();
    emitDeclarationBaseType(cl, params, true);
    emitPos(cl.pos);
    switch publicSurface.superClassFor(params) {
      case null:
      case parent:
        write(' extends ');
        emitBaseType(parent.type.get(), parent.copyArguments());
    }
    final declaredInterfaces = publicSurface.interfacesFor(params);
    final emittedInterfaces = cl.isInterface
      ? declaredInterfaces
      : [
          for (contract in declaredInterfaces)
            if (PublicSurface.runtimeSatisfiesInterface(cl,
              contract.type.get()))
              contract
        ];
    switch emittedInterfaces {
      case null | []:
      case interfaces:
        if (cl.isInterface)
          write(' extends ');
        else
          write(' implements ');
        for (int in join(interfaces, write.bind(', ')))
          emitBaseType(int.type.get(), int.copyArguments());
    }
    write(' {');
    increaseIndent();
    final signatureFields: Array<Field> = [];
    function appendField(field: Field): Void {
      for (signature in field.overloads)
        appendField(signature);
      signatureFields.push(field);
    }
    for (field in fields)
      appendField(field);
    for (field in signatureFields) {
      switch field.kind {
        case Constructor | Method:
          switch field.type {
            case TFun(args, ret):
              writeMemberNewline(field.doc != null);
              emitComment(field.doc);
              if (!field.isPublic)
                write('protected ');
              if (field.isStatic)
                write('static ');
              emitPos(field.pos);
              write(if (field.kind.equals(Constructor)) 'constructor' else
                TypeUtil.nativeName(field.meta) ?? field.name);
              final tsType = field.meta != null
                ? (switch field.meta.extract(':ts.type') {
                  case [{params: [{expr: EConst(CString(type))}]}]:
                    type;
                  default:
                    switch field.meta.extract(':genes.type') {
                      case [{params: [{expr: EConst(CString(type))}]}]:
                        type;
                      default: null;
                    }
                })
                : null;
              if (tsType != null) {
                write(': $tsType');
              } else {
                if (field.params.length > 0)
                  emitParams(field.params.map(p -> p.t), true);
                write('(');
                var optionalPos = args.length;
                for (i in 0...args.length) {
                  final fromEnd = args.length - 1 - i;
                  if (args[fromEnd].opt)
                    optionalPos = fromEnd;
                  else
                    break;
                }
                for (i in joinIt(0...args.length, write.bind(', '))) {
                  final arg = args[i];
                  if (TypeUtil.isRest(arg.t))
                    write('...');
                  emitIdent(arg.name);
                  final nullish = NullishContract.forParameter(arg.t,
                    arg.opt && i >= optionalPos);
                  if (nullish.emitOptionalSyntax)
                    write('?');
                  write(': ');
                  switch field.expr {
                    case null:
                      emitType(nullish.emittedType);
                    case {expr: TFunction(f)}:
                      final meta = f.args[i].v.meta;
                      final paramTypeOverride = switch meta.extract(':ts.type') {
                        case [{params: [{expr: EConst(CString(type))}]}]: type;
                        default:
                          switch meta.extract(':genes.type') {
                            case [{params: [{expr: EConst(CString(type))}]}]:
                              type;
                            default: null;
                          }
                      };
                      if (paramTypeOverride != null)
                        write(paramTypeOverride);
                      else
                        emitType(nullish.emittedType);
                    default:
                      emitType(nullish.emittedType);
                  }
                }
                write(')');
                if (!field.kind.match(Constructor)) {
                  write(': ');
                  switch field.meta {
                    case null:
                      emitType(ret);
                    case meta:
                      final returnTypeOverride = switch meta.extract(':ts.returnType') {
                        case [{params: [{expr: EConst(CString(type))}]}]: type;
                        default:
                          switch meta.extract(':genes.returnType') {
                            case [{params: [{expr: EConst(CString(type))}]}]:
                              type;
                            default: null;
                          }
                      };
                      if (returnTypeOverride != null)
                        write(returnTypeOverride);
                      else
                        emitType(ret);
                  }
                }
              }
            default: throw 'assert';
          }
        case Property:
          writeMemberNewline(field.doc != null);
          emitComment(field.doc);
          emitPos(field.pos);
          if (!field.isPublic)
            write('protected ');
          if (field.isStatic)
            write('static ');
          if (field.getter && !field.setter)
            write('readonly ');
          write(TypeUtil.nativeName(field.meta) ?? field.name);
          final nullish = NullishContract.forProperty(field.type, field.meta);
          if (nullish.emitOptionalSyntax)
            write('?');
          write(': ');
          TypeEmitter.emitNullishProjection(this, nullish, () -> {
            if (field.tsType != null)
              write(field.tsType);
            else
              emitType(nullish.emittedType,
                field.isStatic ? null : field.params);
          }, field.tsType != null);
      }
    }
    decreaseIndent();
    writeNewline();
    write('}');
    writeNewline();
  }

  public function includeType(type: Type) {}

  public function typeAccessor(type: TypeAccessor)
    return ctx.typeAccessor(type);

  function emitBaseType(type: BaseType, params: Array<Type>,
      withConstraints = false) {
    TypeEmitter.emitBaseType(this, type, params, withConstraints);
  }

  function emitDeclarationBaseType(type: BaseType, params: Array<Type>,
      withConstraints = false) {
    TypeEmitter.emitDeclarationBaseType(this, type, params, withConstraints);
  }

  function emitType(type: Type, ?params: Array<TypeParameter>) {
    if (params != null && params.length > 0)
      emitParams(params.map(p -> p.t), true);
    TypeEmitter.emitType(this, type, params == null);
  }

  /** Normalizes classic parameter identity before shared enum alias spelling. */
  function emitEnumConstructorTypeParams(enumParams: Array<Type>,
      constructorParams: Array<Type>) {
    final normalizedEnumParams = uniqueParams(enumParams);
    final enumParamNames = [
      for (param in normalizedEnumParams)
        switch param {
          case TInst(_.get().name => name, _): name;
          default: throw 'Expected an enum type parameter';
        }
    ];
    final normalizedConstructorParams = [
      for (param in uniqueParams(constructorParams))
        if (switch param {
          case TInst(_.get().name => name, _):
            enumParamNames.indexOf(name) == -1;
          default:
            true;
        }) param
    ];
    TypeEmitter.emitEnumConstructorTypeParams(this, normalizedEnumParams,
      normalizedConstructorParams);
  }

  function uniqueParams(params: Array<Type>): Array<Type> {
    final all = new Map<String, Type>();
    for (param in params) {
      switch param {
        case TInst(_.get().name => name, _):
          all.set(name, param);
        default:
      }
    }
    return [for (param in all) param];
  }

  function emitParams(params: Array<Type>, withConstraints = false) {
    TypeEmitter.emitParams(this, uniqueParams(params), withConstraints);
  }
}
