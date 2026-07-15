package dual;

/** Generic value container used by every runtime oracle in the corpus. */
class Box<T> {
  public final value:T;

  public function new(value:T) {
    this.value = value;
  }
}

/** Small generic behavior contract used to exercise interface dispatch. */
interface Transformer<T> {
  public function transform(value:T):T;
}

/** Concrete string transformation shared by current, standard, and vanilla JS. */
class UpperTransformer implements Transformer<String> {
  public function new() {}

  public function transform(value:String):String {
    return value.toUpperCase();
  }
}

/** Runtime enum whose constructor identity must survive every JS emitter. */
enum Mode {
  Fast;
  Careful(reason:String);
}
