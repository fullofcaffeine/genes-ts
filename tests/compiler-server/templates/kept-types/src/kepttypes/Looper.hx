package kepttypes;

/**
 * A class with an inline constructor and an `Array<Phase>` field. Haxe
 * replaces each use of `new Phases(...)` with one local for each field.
 */
class Phases {
  public final all: Array<Phase>;

  public inline function new(all: Array<Phase>) {
    this.all = all;
  }
}

/**
 * No module imports this one; the after-typing gate names it on the command
 * line. Its loop goes over the field of an inline object.
 *
 * Haxe replaces the inline object after the after-typing callbacks: the
 * local `phases` becomes the local `phases_all` of type `Array<Phase>`, and
 * Haxe saves that changed body. A capture in a later request reads
 * `phases_all`; the capture of the first request and a build in a new
 * process do not. In `compare` this gives explained differences.
 */
@:keep
class Looper {
  public static function done(): Int {
    final phases = new Phases([Draft, Done]);
    var count = 0;
    for (phase in phases.all)
      if (phase == Done)
        count++;
    return count;
  }
}
