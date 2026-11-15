package kepttypes;

/** A generic record: the passes keep its field types by source position. */
typedef Envelope<T> = {
  final value: T;
  final phase: Phase;
  @:optional var note: String;
}

/** An alias with a concrete argument that is an enum abstract. */
typedef PhaseEnvelope = Envelope<Phase>;

/** An enum whose constructors carry an enum abstract and a record. */
enum Step {
  Start(phase: Phase);
  Move(by: Int, envelope: Envelope<Int>);
  Stop;
}

/** An interface: the public-surface pass keeps its members. */
interface Named {
  function name(): String;
}
