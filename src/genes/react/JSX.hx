package genes.react;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.ExprTools;
import genes.react.internal.JsxContext;
import genes.react.internal.JsxContext.JsxContextProp;
#end

/**
 * Parses string-literal HXX and returns a normal typed React element.
 *
 * Why: Haxe's inline XML-like syntax cannot express every JSX shape, notably a
 * fragment root. Generated migration code also benefits from one stable macro
 * entry point.
 *
 * What: `jsx('<Button label="Save" />')` accepts a literal template whose
 * `{...}` sections are parsed as real Haxe expressions with authored spans.
 *
 * How: the macro builds typed linked records rather than heterogeneous arrays.
 * Haxe therefore retains each property's and child's exact type. `JsxPlan`
 * consumes the records once and all four output profiles share its checked
 * intent. No parser object or marker call remains in emitted code.
 */
class JSX {
  /**
   * Compile-time JSX/HXX-style authoring macro.
   *
   * Example:
   *   import genes.react.JSX.*;
   *   return jsx('<div className={x}>Hello</div>');
   *
   * The string must be a literal so parsing and source positions stay
   * deterministic. The result is a typed call tree using
   * `genes.react.internal.Jsx.__jsx/__frag`; `JsxPlan` validates and lowers it
   * to typed TSX/createElement, type-erased JSX, or classic runtime calls.
   */
  public static macro function jsx(template: Expr): Expr {
    final pos = template.pos;
    final source = switch template.expr {
      case EConst(CString(s, _)):
        s;
      default:
        Context.error('jsx() expects a string literal', pos);
    };

    final parser = new Parser(source, pos);
    final nodes = parser.parseTopLevel();
    if (nodes.length == 0)
      Context.error('jsx() expects at least one root node', pos);

    final rootExpr = switch nodes {
      case [single]:
        parser.childToExpr(single);
      default:
        // Multiple roots => wrap in fragment.
        parser.fragmentToExpr(nodes);
    }

    return rootExpr;
  }
}
  #if macro
private enum JsxChild {
  Text(value: String, pos: Position);
  Expr(expr: Expr);
  Element(el: JsxElement);
  Fragment(children: Array<JsxChild>, pos: Position);
}

private typedef JsxAttr = {
  final kind: JsxAttrKind;
  final pos: Position;
}

private enum JsxAttrKind {
  Normal(name: String, value: Null<JsxAttrValue>);
  Spread(expr: Expr);
}

private enum JsxAttrValue {
  Str(value: String);
  Expr(expr: Expr);
}

private typedef JsxElement = {
  final tag: String;
  final attrs: Array<JsxAttr>;
  final children: Array<JsxChild>;
  final selfClosing: Bool;
  final pos: Position;
  final tagPos: Position;
}

private class Parser {
  final input: String;
  final pos: Position;
  final file: String;
  final contentStart: Int;
  var i: Int = 0;

  public function new(input: String, pos: Position) {
    this.input = input;
    this.pos = pos;
    final info = Context.getPosInfos(pos);
    file = info.file;
    contentStart = info.max
      - info.min == input.length ? info.min : info.min + 1;
  }

  public function parseTopLevel(): Array<JsxChild> {
    final children = parseChildren(null);
    return normalizeChildren(children);
  }

  public function childToExpr(child: JsxChild): Expr {
    return switch child {
      case Text(v, childPos):
        withPosition(macro $v{v}, childPos);
      case Expr(e):
        e;
      case Fragment(children, fragmentPos):
        withPosition(macro genes.react.internal.Jsx.__frag($e{childrenToCarrier(children)}),
          fragmentPos);
      case Element(el):
        elementToExpr(el);
    }
  }

  public function fragmentToExpr(children: Array<JsxChild>): Expr {
    return
      withPosition(macro genes.react.internal.Jsx.__frag($e{childrenToCarrier(children)}),
      pos);
  }

  function elementToExpr(el: JsxElement): Expr {
    final intrinsic = isIntrinsicTag(el.tag);
    final tagExpr: Expr = if (intrinsic) withPosition(macro $v{el.tag},
      el.tagPos) else
      Context.parseInlineString(el.tag, el.tagPos);

    final contextProps: Array<JsxContextProp> = [];
    final originalValues: Map<Int, Expr> = [];
    for (index in 0...el.attrs.length) {
      switch el.attrs[index].kind {
        case Normal(name, value):
          final expression: Expr = switch value {
            case null: withPosition(macro true, el.attrs[index].pos);
            case Str(s): withPosition(macro $v{s}, el.attrs[index].pos);
            case Expr(found): found;
          }
          originalValues.set(index, expression);
          contextProps.push({index: index, name: name, value: expression});
        case Spread(_):
      }
    }
    final contextual = JsxContext.contextualize(el.tag, tagExpr, intrinsic,
      contextProps);

    var props: Expr = macro {__genesJsxPropsEnd: true};
    for (offset in 0...el.attrs.length) {
      final index = el.attrs.length - offset - 1;
      final attr = el.attrs[index];
      switch attr.kind {
        case Normal(name, value):
          final valueExpr = contextual.exists(index) ? contextual.get(index) : originalValues.get(index);
          props = macro {
            __genesJsxPropName: $v{name},
            __genesJsxPropValue: $valueExpr,
            __genesJsxPropNext: $props
          };
        case Spread(e):
          props = macro {
            __genesJsxSpreadValue: $e,
            __genesJsxPropNext: $props
          };
      }
    }

    final children = normalizeChildren(el.children);
    return withPosition(macro genes.react.internal.Jsx.__jsx(
      $tagExpr, $props,
      $e{childrenToCarrier(children)}),
      el.pos);
  }

  public function childrenToCarrier(children: Array<JsxChild>): Expr {
    var carrier: Expr = macro {__genesJsxChildrenEnd: true};
    final reversed = children.copy();
    reversed.reverse();
    for (child in reversed) {
      final value = childToExpr(child);
      carrier = macro {
        __genesJsxChildValue: $value,
        __genesJsxChildNext: $carrier
      };
  }
    return carrier;
  }

  function isIntrinsicTag(tag: String): Bool {
    if (tag == null || tag.length == 0)
      return false;
    final first = tag.charCodeAt(0);
    return (first >= 'a'.code && first <= 'z'.code) || tag.indexOf('-') >= 0;
  }

  function normalizeChildren(children: Array<JsxChild>): Array<JsxChild> {
    final out: Array<JsxChild> = [];
    for (c in children) {
      switch c {
        case Text(v, childPos):
          final norm = normalizeText(v);
          if (norm.length == 0)
            continue;
          // Coalesce adjacent text nodes.
          if (out.length > 0) {
            switch out[out.length - 1] {
              case Text(prev, previousPos):
                out[out.length - 1] = Text(normalizeText(prev + norm),
                  mergePositions(previousPos, childPos));
              default:
                out.push(Text(norm, childPos));
            }
          } else {
            out.push(Text(norm, childPos));
          }
        case _:
          out.push(c);
      }
    }
    return out;
  }

  static function normalizeText(s: String): String {
    // Collapse whitespace so indentation/newlines in templates don't create
    // accidental whitespace-only text nodes (similar to typical JSX authoring).
    final re = ~/[ \t\r\n]+/g;
    final collapsed = re.replace(s, ' ');
    // Drop whitespace-only nodes, but preserve meaningful boundary spaces
    // ("Hello <span/> World") by not trimming.
    if (StringTools.trim(collapsed).length == 0)
      return '';
    return collapsed;
  }

  function parseChildren(untilClosingTag: Null<String>): Array<JsxChild> {
    final out: Array<JsxChild> = [];
    while (true) {
      if (eof())
        break;
      if (peek() == '<') {
        // Fragment open: <>
        if (peek(1) == '>') {
          final fragmentStart = i;
          i += 2; // consume "<>"
          final children = normalizeChildren(parseChildren(''));
          out.push(Fragment(children, sourcePosition(fragmentStart, i)));
          continue;
        }
        if (peek(1) == '/') {
          // Closing tag.
          final closing = parseClosingTag();
          if (untilClosingTag == null)
            Context.error('Unexpected closing tag </$closing>', pos);
          if (closing != untilClosingTag)
            Context.error('Mismatched closing tag </$closing> (expected </$untilClosingTag>)',
              pos);
          break;
        }
        out.push(Element(parseElement()));
        continue;
      }
      if (peek() == '{') {
        out.push(Expr(parseBraceExpr()));
        continue;
      }
      final textStart = i;
      out.push(Text(readText(), sourcePosition(textStart, i)));
    }
    return out;
  }

  function parseElement(): JsxElement {
    final elementStart = i;
    expect('<');
    final tagStart = i;
    final tag = readTagName();
    final tagPos = sourcePosition(tagStart, i);
    final attrs = parseAttributes();

    // Self closing?
    if (tryConsume("/>")) {
      return {
        tag: tag,
        attrs: attrs,
        children: [],
        selfClosing: true,
        pos: sourcePosition(elementStart, i),
        tagPos: tagPos
      };
    }

    expect('>');
    final children = parseChildren(tag);
    return {
      tag: tag,
      attrs: attrs,
      children: children,
      selfClosing: false,
      pos: sourcePosition(elementStart, i),
      tagPos: tagPos
    };
  }

  function parseClosingTag(): String {
    expect('<');
    expect('/');
    // Fragment close: </>
    if (!eof() && peek() == '>') {
      i++;
      return '';
    }
    final name = readTagName();
    skipWs(true);
    expect('>');
    return name;
  }

  function parseAttributes(): Array<JsxAttr> {
    final attrs: Array<JsxAttr> = [];
    while (true) {
      skipWs(true);
      if (eof())
        Context.error('Unexpected end of input while reading attributes', pos);
      if (startsWith("/>") || peek() == '>')
        break;
      final attrStart = i;

      // Spread attribute: {...expr}
      if (peek() == '{') {
        final spreadExpr = parseSpreadAttribute();
        attrs.push({kind: Spread(spreadExpr),
          pos: sourcePosition(attrStart, i)
        });
        continue;
      }

      final name = readAttrName();
      skipWs(true);
      if (tryConsume("=")) {
        skipWs(true);
        final value = switch peek() {
          case '"', "'":
            Str(readQuotedString());
          case '{':
            Expr(parseBraceExpr());
          default:
            // Best-effort: treat bare value as string token.
            Str(readBareToken());
        }
        attrs.push({kind: Normal(name, value),
          pos: sourcePosition(attrStart, i)
        });
      } else {
        // Boolean attribute.
        attrs.push({kind: Normal(name, null),
          pos: sourcePosition(attrStart, i)
        });
      }
    }
    return attrs;
  }

  function parseSpreadAttribute(): Expr {
    final content = readBraceContent();
    final trimmed = StringTools.trim(content.raw);
    if (!StringTools.startsWith(trimmed, '...'))
      Context.error('Expected spread attribute like `{...props}`',
        sourcePosition(content.start, content.end));
    final exprStr = StringTools.trim(trimmed.substr(3));
    if (exprStr.length == 0)
      Context.error('Spread attribute missing expression',
        sourcePosition(content.start, content.end));
    final expressionOffset = content.raw.indexOf(exprStr);
    return rewriteMarkupExpr(Context.parseInlineString(exprStr,
      sourcePosition(content.start + expressionOffset,
        content.start + expressionOffset + exprStr.length)));
  }

  function parseBraceExpr(): Expr {
    final content = readBraceContent();
    final exprStr = StringTools.trim(content.raw);
    if (exprStr.length == 0)
      Context.error('Empty `{}` expression in jsx()',
        sourcePosition(content.start, content.end));
    final expressionOffset = content.raw.indexOf(exprStr);
    return rewriteMarkupExpr(Context.parseInlineString(exprStr,
      sourcePosition(content.start + expressionOffset,
        content.start + expressionOffset + exprStr.length)));
  }

  static function rewriteMarkupExpr(expr: Expr): Expr {
    if (expr == null)
      return expr;
    return switch expr.expr {
      case EMeta(meta, inner)
        if (meta != null && (meta.name == ':markup' || meta.name == 'markup')):
        final call = macro genes.react.JSX.jsx($inner);
        call.pos = expr.pos;
        call;
      default:
        ExprTools.map(expr, rewriteMarkupExpr);
    }
  }

  function readText(): String {
    final start = i;
    while (!eof()) {
      final ch = peek();
      if (ch == '<' || ch == '{')
        break;
      i++;
    }
    return input.substr(start, i - start);
  }

  function readTagName(): String {
    skipWs(true);
    final start = i;
    while (!eof()) {
      final ch = peek();
      if (!isTagNameChar(ch))
        break;
      i++;
    }
    if (i == start)
      Context.error('Expected tag name', pos);
    return input.substr(start, i - start);
  }

  function readAttrName(): String {
    final start = i;
    while (!eof()) {
      final ch = peek();
      if (ch == '=' || ch == '>' || ch == '/' || isWs(ch))
        break;
      i++;
    }
    if (i == start)
      Context.error('Expected attribute name', pos);
    return input.substr(start, i - start);
  }

  function readBareToken(): String {
    final start = i;
    while (!eof()) {
      final ch = peek();
      if (isWs(ch) || ch == '>' || startsWith("/>"))
        break;
      i++;
    }
    return input.substr(start, i - start);
  }

  function readQuotedString(): String {
    final quote = peek();
    i++; // consume quote
    final start = i;
    while (!eof()) {
      final ch = peek();
      if (ch == '\\') {
        i += 2;
        continue;
      }
      if (ch == quote)
        break;
      i++;
    }
    if (eof())
      Context.error('Unterminated string literal in jsx()', pos);
    final s = input.substr(start, i - start);
    i++; // consume closing quote
    return s;
  }

  function readBraceContent(): {
    final raw: String;
    final start: Int;
    final end: Int;
  } {
    expect('{');
    final start = i;
    var depth = 1;
    var inSingle = false;
    var inDouble = false;
    while (!eof()) {
      final ch = peek();
      if (ch == '\\') {
        i += 2;
        continue;
      }
      if (!inDouble && ch == "'") {
        inSingle = !inSingle;
        i++;
        continue;
      }
      if (!inSingle && ch == '"') {
        inDouble = !inDouble;
        i++;
        continue;
      }
      if (!inSingle && !inDouble) {
        if (ch == '{') {
          depth++;
          i++;
          continue;
        }
        if (ch == '}') {
          depth--;
          if (depth == 0) {
            final end = i;
            final raw = input.substr(start, end - start);
            i++; // consume final }
            return {raw: raw, start: start, end: end};
          }
          i++;
          continue;
        }
      }
      i++;
    }
    Context.error('Unterminated `{...}` in jsx()', sourcePosition(start, i));
    return {raw: '', start: start, end: i};
  }

  inline function eof(): Bool
    return i >= input.length;

  inline function peek(offset = 0): String
    return input.charAt(i + offset);

  inline function startsWith(s: String): Bool
    return input.substr(i, s.length) == s;

  function tryConsume(s: String): Bool {
    if (!startsWith(s))
      return false;
    i += s.length;
    return true;
  }

  function expect(s: String) {
    if (eof() || peek() != s)
      Context.error('Expected `${s}` in jsx()', sourcePosition(i, i + 1));
    i++;
  }

  function sourcePosition(start: Int, end: Int): Position {
    final safeStart = start < 0 ? 0 : (start > input.length ? input.length : start);
    final safeEnd = end < safeStart ? safeStart : (end > input.length ? input.length : end);
    return Context.makePosition({
      file: file,
      min: contentStart + safeStart,
      max: contentStart + safeEnd
    });
  }

  static function withPosition(expression: Expr, position: Position): Expr {
    expression.pos = position;
    return expression;
  }

  static function mergePositions(left: Position, right: Position): Position {
    final leftInfo = Context.getPosInfos(left);
    final rightInfo = Context.getPosInfos(right);
    return Context.makePosition({
      file: leftInfo.file,
      min: leftInfo.min < rightInfo.min ? leftInfo.min : rightInfo.min,
      max: leftInfo.max > rightInfo.max ? leftInfo.max : rightInfo.max
    });
  }

  inline function isWs(ch: String): Bool
    return ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n';

  function skipWs(inTag: Bool) {
    while (!eof()) {
      final ch = peek();
      if (!isWs(ch))
        break;
      i++;
    }
  }

  static function isTagNameChar(ch: String): Bool {
    if (ch == null || ch.length == 0)
      return false;
    final c = ch.charCodeAt(0);
    return (c >= 'a'.code && c <= 'z'.code) || (c >= 'A'.code && c <= 'Z'.code)
      || (c >= '0'.code && c <= '9'.code) || ch == '_' || ch == '-' || ch == '.'
      || ch == ':'; // allow namespaced tags
  }
}
#end
