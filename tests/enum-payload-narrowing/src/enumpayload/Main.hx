package enumpayload;

import enumpayload.Reduction.Failure;

class Main {
  /**
   * Haxe knows only `Reduced` can inhabit this application and may erase the
   * authored switch to one exact payload read.
   */
  static function elided(value: Reduction<Int, Never, Never, String>): String {
    return switch value {
      case Reduced(result): result;
    };
  }

  /** Ordinary switch whose emitted `_hx_index` check narrows TypeScript. */
  static function visible(value: Reduction<Int, Failure, Failure,
    String>): String {
    return switch value {
      case Crashed(error, _): error.message;
      case Failed(error): error.message;
      case Reduced(result): result;
    };
  }

  /**
   * The direct call proves the planned receiver is evaluated once. Its marker
   * type otherwise appears in `Factory.ts`, not in this generated module.
   */
  static function imported(): String {
    return switch Factory.read() {
      case Reduced(result): result.label;
    };
  }

  public static function main(): Void {
    final elidedValue: Reduction<Int, Never, Never,
      String> = Reduction.Reduced("elided");
    final visibleValue: Reduction<Int, Failure, Failure,
      String> = Reduction.Failed(new Failure("visible"));
    NodeConsole.log([elided(elidedValue), visible(visibleValue), imported()].join("|"));
  }
}
