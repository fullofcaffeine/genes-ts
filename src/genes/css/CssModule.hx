package genes.css;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;
#end

/**
 * Imports one relative CSS Module as the exact object described by a generated
 * companion such as `CardStyles`.
 *
 * The application's CSS Modules processor decides which class names really
 * exist. Genes tooling turns that trusted list into a closed Haxe type. This
 * macro checks that the type belongs to the current Haxe module and stylesheet,
 * then emits one ordinary default import through Genes' existing machinery.
 *
 * Write the companion type on the receiving value so Haxe can offer class-name
 * completion and reject missing fields before JavaScript or TypeScript exists:
 *
 * ```haxe
 * import genes.css.CssModule.imported;
 *
 * final styles:CardStyles =
 *   imported("./card.module.css", "styles");
 * ```
 *
 * The optional name only improves the generated local import name. It does not
 * change module identity or create another runtime import. Genes does not parse
 * CSS, rename runtime classes, or add a styling runtime; the application's
 * processor and bundler remain responsible for CSS behavior.
 */
macro function imported<T>(request: ExprOf<String>,
    ?as: ExprOf<String>): ExprOf<T> {
  #if macro
  final callPos = Context.currentPos();
  if (!Context.defined("js")
    || !Context.defined(genes.CompilerInternal.GENERATOR_ACTIVE_DEFINE)) {
    Context.error("GENES-CSS-MODULE-TARGET-001: genes.css.CssModule.imported requires the active Genes JavaScript or TypeScript generator.",
      callPos);
  }

  final requestValue = requireRequest(request);
  final expected = Context.getExpectedType();
  if (expected == null) {
    Context.error("GENES-CSS-MODULE-TYPE-009: Add the generated companion type, for example `final styles:CardStyles = imported(\"./card.module.css\")`.",
      callPos);
  }

  final binding = companionBinding(expected, callPos);
  final localModule = Context.getLocalModule();
  if (binding.owner != localModule) {
    Context.error('GENES-CSS-MODULE-BINDING-010: ${binding.typeName} belongs to `${binding.owner}`, not the current Haxe module `$localModule`.',
      callPos);
  }
  if (binding.request != requestValue) {
    Context.error('GENES-CSS-MODULE-BINDING-010: ${binding.typeName} was generated for `${binding.request}`, not `$requestValue`.',
      callPos);
  }
  return genes.ts.Imports.defaultImportExpression(request, as);
  #else
  return null;
  #end
}

#if macro
function requireRequest(request: Expr): String {
  final value = switch request.expr {
    case EConst(CString(literal, _)):
      literal;
    default:
      Context.error("GENES-CSS-MODULE-REQUEST-LITERAL-001: CSS Module request must be a non-empty string literal, for example `\"./card.module.css\"`.",
        request.pos);
  }

  var hasControl = false;
  for (index in 0...value.length) {
    final code = StringTools.fastCodeAt(value, index);
    if (code < 32 || code == 127) {
      hasControl = true;
      break;
    }
  }
  final isRelative = StringTools.startsWith(value, "./")
    || StringTools.startsWith(value, "../");
  if (value.length == 0
    || !isRelative
    || !StringTools.endsWith(value, ".module.css")
    || value.indexOf("\\") >= 0
    || value.indexOf("?") >= 0
    || value.indexOf("#") >= 0
    || hasControl) {
    Context.error("GENES-CSS-MODULE-REQUEST-LITERAL-001: Use a literal relative path ending in `.module.css`, without a query or hash, for example `\"./card.module.css\"`.",
      request.pos);
  }
  return value;
}

function companionBinding(type: Type, pos: Position): CssModuleBinding {
  return switch type {
    case TMono(reference) if (reference.get() != null):
      companionBinding(reference.get(), pos);
    case TLazy(resolve):
      companionBinding(resolve(), pos);
    case TType(definition, _):
      final type = definition.get();
      final metadata = type.meta.extract(":genes.cssModuleCompanion");
      if (metadata.length != 1) {
        Context.error('GENES-CSS-MODULE-TYPE-009: `${type.pack.concat([type.name]).join(".")}` is not a generated CSS Module companion.',
          pos);
      }
      final entry = metadata[0];
      if (entry.params.length != 3) {
        Context.error("GENES-CSS-MODULE-TYPE-009: Generated CSS Module companion metadata is incomplete. Regenerate the companion.",
          pos);
      }
      final owner = metadataString(entry.params[0], pos);
      final request = metadataString(entry.params[1], pos);
      final digest = metadataString(entry.params[2], pos);
      if (!~/^sha256:[0-9a-f]{64}$/.match(digest)) {
        Context.error("GENES-CSS-MODULE-TYPE-009: Generated CSS Module companion has an invalid manifest digest. Regenerate the companion.",
          pos);
      }
      {
        typeName: type.pack.concat([type.name]).join("."),
        owner: owner,
        request: request
      };
    default:
      Context.error("GENES-CSS-MODULE-TYPE-009: imported needs an explicit generated companion type, for example `final styles:CardStyles = imported(\"./card.module.css\")`.",
        pos);
  }
}

function metadataString(expression: Expr, pos: Position): String {
  return switch expression.expr {
    case EConst(CString(value, _)):
      value;
    default:
      Context.error("GENES-CSS-MODULE-TYPE-009: Generated CSS Module companion metadata is invalid. Regenerate the companion.",
        pos);
  }
}
#end

#if macro
private typedef CssModuleBinding = {
  final typeName: String;
  final owner: String;
  final request: String;
}
#end
