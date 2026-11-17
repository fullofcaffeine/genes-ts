package mr;

/** The program root of the module-request fixture. */
class Main {
  static function main() {
    trace(Button.render());
    trace(new Panel('main').describe());
    trace(Consts.LIMIT + Consts.describe().length);
    trace(Leaf.kindName(Leaf.Kind.Small));
    trace(Cycle.start());
    trace(Theme.size());
  }
}
