package refresh;

import genes.react.Element;

/** Code in another module that calls back into an instance it receives. */
interface CallbackRender {
  function render(): Element;
}

class CallbackRunner {
  public static function run(target: CallbackRender): Element {
    return target.render();
  }
}

/** A parent constructor that calls a method that a subclass overrides. */
class CallbackBase {
  public function new() {
    setup();
  }

  function setup(): Void {}
}
