package genes;

import helder.Set;

/**
 * Owns JavaScript identifier facts shared by planners and expression printers.
 *
 * Why: a module-level binding must be rejected before emission when its exact
 * requested spelling is illegal, while ordinary Haxe locals and members still
 * need Genes' long-standing escaping behavior. Keeping separate keyword lists
 * in those paths would let a new capability accept a name that a printer later
 * rewrites—or reject a name the printer considers safe.
 *
 * What: `isKeyword` and `isUnavailableLocal` preserve the existing emitter
 * policy byte-for-byte. `isValidModuleBinding` adds the stricter ES-module
 * rule for an exact, user-requested top-level binding; notably, `await` is not
 * a valid binding in a module even though it remains a legal property name.
 *
 * How: callers validate raw names here, then printers continue to choose
 * member, local, or binding syntax explicitly. The conservative ASCII grammar
 * keeps classic JavaScript, TypeScript, TSX, and source-map columns aligned;
 * Unicode identifiers can be added only as a shared, tested extension.
 */
class IdentifierPolicy {
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

  static final unavailableLocals = new Set([
    'Infinity',
    'NaN',
    'decodeURI',
    'decodeURIComponent',
    'encodeURI',
    'encodeURIComponent',
    'escape',
    'eval',
    'isFinite',
    'isNaN',
    'parseFloat',
    'parseInt',
    'undefined',
    'unescape',
    'JSON',
    'Number',
    'Object',
    'console',
    'window',
    'require'
  ]);

  /** Whether Genes' existing identifier printers escape this spelling. */
  public static function isKeyword(name: String): Bool {
    return keywords.exists(name);
  }

  /** Whether a Haxe local must avoid a host/global or reserved spelling. */
  public static function isUnavailableLocal(name: String): Bool {
    return isKeyword(name) || unavailableLocals.exists(name);
  }

  /** Whether `name` is the conservative ASCII identifier subset. */
  public static function isAsciiIdentifier(name: String): Bool {
    if (name == null || name.length == 0)
      return false;
    final first = name.charCodeAt(0);
    if (!isAsciiIdentifierStart(first))
      return false;
    for (index in 1...name.length) {
      final code = name.charCodeAt(index);
      if (!isAsciiIdentifierStart(code)
        && !(code >= '0'.code && code <= '9'.code))
        return false;
    }
    return true;
  }

  /** Whether a requested exact name can be declared in an ES module. */
  public static function isValidModuleBinding(name: String): Bool {
    return isAsciiIdentifier(name) && !isKeyword(name) && name != 'await';
  }

  static inline function isAsciiIdentifierStart(code: Int): Bool {
    return (code >= 'a'.code && code <= 'z'.code)
      || (code >= 'A'.code && code <= 'Z'.code)
      || code == '_'.code
      || code == '$'.code;
  }
}
