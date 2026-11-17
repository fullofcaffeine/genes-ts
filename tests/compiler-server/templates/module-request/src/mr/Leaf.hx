package mr;

enum Kind {
  Small;
  Large;
}

/** A module with an enum and a function over it. */
class Leaf {
  public static function kindName(kind: Kind): String {
    return switch kind {
      case Small: 'small';
      case Large: 'large';
    }
  }
}
