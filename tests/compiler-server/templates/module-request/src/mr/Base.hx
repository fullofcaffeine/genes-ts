package mr;

/** A parent class in another module. */
class Base {
  public final name: String;

  public function new(name: String) {
    this.name = name;
  }

  public function describe(): String {
    return 'base ' + name;
  }
}
