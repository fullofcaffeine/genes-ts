package kepttypes;

import kepttypes.Shapes;

class Main {
  static function main() {
    final subject = new Untouched(Draft);
    final phase = subject.advance([Start(Done), Move(2,
      {value: 1, phase: Draft}), Stop]);
    final names: Array<Named> = [subject];
    trace(phase, names[0].name(), Dependent.read(), Dependent.value,
      Untouched.defaultPhase);
  }
}
