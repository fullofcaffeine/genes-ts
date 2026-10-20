package enumpayload;

private enum Selection<T> {
  Selected(value: T);
  Rejected(message: String);
}

/** Static value expressions must keep branch selection and evaluate once. */
class StaticSelection {
  static var calls = 0;
  static final selected = switch choose(#if static_selection_failure false #else true #end) {
      case Selected(value): value;
      case Rejected(message): throw message;
    };
  static final rejected = switch choose(false) {
      case Selected(_): throw "wrong branch";
      case Rejected(message): message;
    };

  static function choose(accept: Bool): Selection<String> {
    calls++;
    return accept ? Selected("selected" + calls) : Rejected("rejected" + calls);
  }

  public static function result(): String {
    return [selected, rejected, Std.string(calls)].join(":");
  }
}
