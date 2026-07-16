package internaltypes;

/** Module-private structural contract used only by this implementation. */
private interface LocalTag {
  function label():String;
}

/** Module-private runtime implementation retained for local behavior. */
private class LocalBox implements LocalTag {
  final value:String;

  public function new(value:String) {
    this.value = value;
  }

  public function label():String {
    return value;
  }
}

/** Module-private type spelling required by genes-ts implementation checking. */
private typedef LocalRecord = {
  final value:String;
}

/** Module-private enum whose ordinary Haxe reflection identity is preserved. */
private enum LocalState {
  Ready;
}

/** Public secondary module type proving Haxe visibility is not inferred by name. */
enum PublicSibling {
  PublicReady;
}

/**
 * Models a compiler-owned generic implementation type without making it API.
 *
 * Why: future ts2hx control-flow lowering needs a typed enum to survive Haxe
 * typing and full DCE, but exporting or registering that enum would expose a
 * compiler implementation detail to applications.
 *
 * What: `@:genes.compilerInternal` requests the final Genes output projection:
 * emit this private enum for local implementation typing, but omit module
 * exports, classic declarations, runtime type registration, and source maps.
 *
 * How: public code below constructs and switches over both generic variants,
 * proving that projection happens only after the typed AST and DCE have used
 * the enum. Standard Haxe ignores the metadata and still runs ordinary Haxe.
 */
@:genes.compilerInternal
private enum InternalResult<T> {
  Value(value:T);
  Empty;
}

/** Public entry point proving private and compiler-internal types stay usable. */
class Main {
  public static function evaluate(value:String):String {
    final local:LocalTag = new LocalBox(value);
    final record:LocalRecord = {value: local.label()};
    final result:InternalResult<String> = Value(record.value);
    final resolved = switch result {
      case Value(found): found;
      case Empty: "empty";
    };
    return switch LocalState.Ready {
      case Ready: resolved;
    }
  }

  public static function main():Void {
    final value = switch publicState() {
      case PublicReady: evaluate("typed");
    }
    NodeConsole.log(value);
  }

  public static function publicState():PublicSibling {
    return PublicReady;
  }
}
