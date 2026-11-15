package kepttypes;

/** A closed set of values. The after-typing passes keep its literal spelling. */
enum abstract Phase(String) {
  var Draft = "draft";
  var Done = "done";
}
