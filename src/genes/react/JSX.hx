package genes.react;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.ExprTools;
#end

class JSX {
  /**
   * Compile-time JSX/HXX-style authoring macro.
   *
   * Example:
   *   import genes.react.JSX.*;
   *   return jsx('<div className={x}>Hello</div>');
   *
   * Output is a call tree using `genes.react.internal.Jsx.__jsx/__frag` which
   * the genes-ts emitter lowers into either TSX or `React.createElement(...)`.
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
        macro genes.react.internal.Jsx.__frag([$a{nodes.map(parser.childToExpr)}]);
    }

    return rootExpr;
  }
}

#if macro
private enum JsxChild {
  Text(value: String);
  Expr(expr: Expr);
  Element(el: JsxElement);
  Fragment(children: Array<JsxChild>);
}

private typedef JsxAttr = {
  final kind: JsxAttrKind;
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
}

private class Parser {
  final input: String;
  final pos: Position;
  var i: Int = 0;

  public function new(input: String, pos: Position) {
    this.input = input;
    this.pos = pos;
  }

  public function parseTopLevel(): Array<JsxChild> {
    final children = parseChildren(null);
    return normalizeChildren(children);
  }

  public function childToExpr(child: JsxChild): Expr {
    return switch child {
      case Text(v):
        macro $v{v};
      case Expr(e):
        e;
      case Fragment(children):
        macro genes.react.internal.Jsx.__frag([$a{children.map(childToExpr)}]);
      case Element(el):
        elementToExpr(el);
    }
  }

  function elementToExpr(el: JsxElement): Expr {
    final tagExpr: Expr = if (isIntrinsicTag(el.tag))
      macro $v{el.tag}
    else
      Context.parse(el.tag, pos);

    final props: Array<Expr> = [];
    for (attr in el.attrs) {
      switch attr.kind {
        case Normal(name, value):
          final valueExpr: Expr = switch value {
            case null:
              macro true;
            case Str(s):
              macro $v{s};
            case Expr(e):
              e;
          }
          props.push(macro { name: $v{name}, value: $valueExpr });
        case Spread(e):
          props.push(macro { spread: $e });
      }
    }

    final children = normalizeChildren(el.children);
    return macro genes.react.internal.Jsx.__jsx(
      $tagExpr,
      [$a{props}],
      [$a{children.map(childToExpr)}]
    );
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
        case Text(v):
          final norm = normalizeText(v);
          if (norm.length == 0)
            continue;
          // Coalesce adjacent text nodes.
          if (out.length > 0) {
            switch out[out.length - 1] {
              case Text(prev):
                out[out.length - 1] = Text(normalizeText(prev + norm));
              default:
                out.push(Text(norm));
            }
          } else {
            out.push(Text(norm));
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
          i += 2; // consume "<>"
          final children = normalizeChildren(parseChildren(''));
          out.push(Fragment(children));
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
      out.push(Text(readText()));
    }
    return out;
  }

  function parseElement(): JsxElement {
    expect('<');
    final tag = readTagName();
    final attrs = parseAttributes();

    // Self closing?
    if (tryConsume("/>")) {
      return {
        tag: tag,
        attrs: attrs,
        children: [],
        selfClosing: true
      };
    }

    expect('>');
    final children = parseChildren(tag);
    return {
      tag: tag,
      attrs: attrs,
      children: children,
      selfClosing: false
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

      // Spread attribute: {...expr}
      if (peek() == '{') {
        final spreadExpr = parseSpreadAttribute();
        attrs.push({kind: Spread(spreadExpr)});
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
        attrs.push({kind: Normal(name, value)});
      } else {
        // Boolean attribute.
        attrs.push({kind: Normal(name, null)});
      }
    }
    return attrs;
  }

  function parseSpreadAttribute(): Expr {
    final raw = readBraceContent();
    final trimmed = StringTools.trim(raw);
    if (!StringTools.startsWith(trimmed, '...'))
      Context.error('Expected spread attribute like `{...props}`', pos);
    final exprStr = StringTools.trim(trimmed.substr(3));
    if (exprStr.length == 0)
      Context.error('Spread attribute missing expression', pos);
    return rewriteMarkupExpr(Context.parse(exprStr, pos));
  }

  function parseBraceExpr(): Expr {
    final raw = readBraceContent();
    final exprStr = StringTools.trim(raw);
    if (exprStr.length == 0)
      Context.error('Empty `{}` expression in jsx()', pos);
    return rewriteMarkupExpr(Context.parse(exprStr, pos));
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

  function readBraceContent(): String {
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
            final s = input.substr(start, i - start);
            i++; // consume final }
            return s;
          }
          i++;
          continue;
        }
      }
      i++;
    }
    Context.error('Unterminated `{...}` in jsx()', pos);
    return '';
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
      Context.error('Expected `${s}` in jsx()', pos);
    i++;
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
