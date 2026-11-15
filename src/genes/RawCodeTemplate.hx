package genes;

/**
 * One piece of a raw code template, in the order in which it is printed.
 */
enum RawCodePart {
  /** Text that reaches the generated file unchanged. */
  Text(text: String);

  /**
   * A `{n}` placeholder that names value argument `index`.
   *
   * `source` is the text between the braces, for a diagnostic. `offset` is
   * the number of template characters before the opening brace. `index` can
   * be negative; the emitter rejects every index that has no value.
   */
  Placeholder(index: Int, source: String, offset: Int);

  /**
   * A placeholder whose number is too large to be an argument index.
   *
   * Haxe prints such a number as text when it does not fit its own integer
   * type, and reports an error otherwise. Genes does not copy that limit: it
   * always reports an error, because no call has that many arguments.
   */
  OversizedPlaceholder(source: String, offset: Int);
}

/**
 * Splits a raw code template by the rules of Haxe's own JavaScript printer.
 *
 * Why: `js.Syntax.code("...")` without value arguments, and every legacy
 * `__js__(...)` call, used to be printed by Haxe (`Codegen.interpolate_code`
 * in the Haxe compiler). Genes now prints them itself, and the text must stay
 * byte-identical. The rules are small but not obvious, so they live in one
 * pure function instead of in the printer.
 *
 * What: the rules, applied from left to right:
 *
 * - `{{` prints one `{`, and `}}` prints one `}`. So
 *   `js.Syntax.code("[{{a: 1}}]")` prints `[{a: 1}]`.
 * - `{text}`, where `text` holds no brace and is an integer in OCaml's
 *   notation, is a placeholder: `{0}`, `{12}`, but also `{+1}`, `{0x1}` and
 *   `{1_0}`.
 * - `{text}` with any other text prints unchanged: `{x}`, `{ 0 }`, `{1e3}`.
 * - Every other brace prints unchanged.
 *
 * How: one scan with no state besides the position. The function returns
 * the parts in print order and joins adjacent text into one part. It knows
 * nothing about values; the emitter decides what a placeholder prints and
 * reports a placeholder that has no value. It is a module-level function:
 * call it as `genes.RawCodeTemplate.parts(template)`.
 *
 * Not used for `js.Syntax.code` WITH value arguments. That form has always
 * been printed by Genes with a simpler rule (`ExprEmitter.emitSyntaxCodeWithArgs`:
 * only `{digits}`, no `{{` rule), and existing programs depend on its output.
 *
 * See also: `tests/syntax-code-forms/README.md` for the forms and their
 * expected output.
 */
function parts(template: String): Array<RawCodePart> {
  final result: Array<RawCodePart> = [];
  var text = new StringBuf();
  var pending = false;
  function flush() {
    if (pending) {
      result.push(Text(text.toString()));
      text = new StringBuf();
      pending = false;
    }
  }
  function add(value: String) {
    text.add(value);
    pending = true;
  }
  final length = template.length;
  var index = 0;
  while (index < length) {
    final code = StringTools.fastCodeAt(template, index);
    if (!isBrace(code)) {
      final end = nextBrace(template, index + 1);
      add(template.substring(index, end));
      index = end;
      continue;
    }
    if (index + 1 < length
      && StringTools.fastCodeAt(template, index + 1) == code) {
      add(String.fromCharCode(code));
      index += 2;
      continue;
    }
    if (code == "{".code) {
      final end = nextBrace(template, index + 1);
      if (end > index + 1 && end < length
        && StringTools.fastCodeAt(template, end) == "}".code) {
        final source = template.substring(index + 1, end);
        switch argumentIndex(source) {
          case NotAnInteger:
            add('{' + source + '}');
          case Index(value):
            flush();
            result.push(Placeholder(value, source, index));
          case TooLarge:
            flush();
            result.push(OversizedPlaceholder(source, index));
        }
        index = end + 1;
        continue;
      }
    }
    add(String.fromCharCode(code));
    index++;
  }
  flush();
  return result;
}

private inline function isBrace(code: Int): Bool
  return code == "{".code || code == "}".code;

/** Returns the position of the first brace at or after `from`. */
private function nextBrace(template: String, from: Int): Int {
  var index = from;
  while (index < template.length
    && !isBrace(StringTools.fastCodeAt(template, index)))
    index++;
  return index;
}

/**
 * Reads `source` the way OCaml's `int_of_string` does.
 *
 * Haxe's printer calls that function on the text between two braces, so
 * its notation decides what is a placeholder: an optional `-` or `+`, an
 * optional `0x`, `0o`, `0b` or `0u` prefix, one digit, then digits or `_`.
 */
private function argumentIndex(source: String): RawCodeIndex {
  final length = source.length;
  var position = 0;
  var negative = false;
  if (position < length) {
    switch StringTools.fastCodeAt(source, position) {
      case "-".code:
        negative = true;
        position++;
      case "+".code:
        position++;
      default:
    }
  }
  var base = 10;
  if (position + 1 < length
    && StringTools.fastCodeAt(source, position) == "0".code) {
    switch StringTools.fastCodeAt(source, position + 1) {
      case "x".code | "X".code:
        base = 16;
        position += 2;
      case "o".code | "O".code:
        base = 8;
        position += 2;
      case "b".code | "B".code:
        base = 2;
        position += 2;
      case "u".code | "U".code:
        position += 2;
      default:
    }
  }
  if (position >= length)
    return NotAnInteger;
  final first = digit(StringTools.fastCodeAt(source, position));
  if (first < 0 || first >= base)
    return NotAnInteger;
  var value: Float = first;
  position++;
  while (position < length) {
    final code = StringTools.fastCodeAt(source, position);
    position++;
    if (code == "_".code)
      continue;
    final next = digit(code);
    if (next < 0 || next >= base)
      return NotAnInteger;
    if (value <= INDEX_LIMIT)
      value = value * base + next;
  }
  if (value > INDEX_LIMIT)
    return TooLarge;
  final index = Std.int(value);
  return Index(negative ? -index : index);
}

private function digit(code: Int): Int {
  if (code >= "0".code && code <= "9".code)
    return code - "0".code;
  if (code >= "A".code && code <= "Z".code)
    return code - "A".code + 10;
  if (code >= "a".code && code <= "z".code)
    return code - "a".code + 10;
  return -1;
}

/** The largest index that is kept as a number; see `OversizedPlaceholder`. */
private inline final INDEX_LIMIT = 1000000.0;

/** The result of reading the text between two braces as an argument index. */
private enum RawCodeIndex {
  NotAnInteger;
  Index(value: Int);
  TooLarge;
}
