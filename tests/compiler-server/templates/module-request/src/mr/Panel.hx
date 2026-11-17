package mr;

/** A class with a parent class and an interface from other modules. */
class Panel extends Base implements Widget {
  public function new(name: String) {
    super(name);
  }

  override public function describe(): String {
    return 'panel ' + name + ' ' + Button.render();
  }
}
