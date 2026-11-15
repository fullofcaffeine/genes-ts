package kepttypes;

/** The test edits the value of this inline function. */
class RetypeOwner {
  public static inline function plain(): Int {
    return 1; // retype-value
  }
}
