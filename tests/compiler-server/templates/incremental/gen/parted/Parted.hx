package parted;

/**
 * A module whose source folder sits inside a candidate folder of the
 * session (see "a source inside the parting folder" in the shadow gate).
 * Its source map names this file by a relative path that starts with the
 * candidate folder's name.
 */
class Parted {
  public static function value(): String {
    return "parted";
  }
}
