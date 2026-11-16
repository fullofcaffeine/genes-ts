package inc;

/** The edit adds the first use of `js.Boot.isEnum` (an inline function) at the marker. */
class EnumCheck {
  public static function value(shape: Shape): String {
    final text = switch shape {
      case Circle(radius): 'circle$radius';
      case Square: "square";
    }
    return text /*ENUM_CHECK*/;
  }
}
