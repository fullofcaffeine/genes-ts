package sideeffectevidence;

/** Second converted-module analogue retained only through its typed anchor. */
class Second {
  @:keep
  public static final initialized:Int = Events.values.push("second");

  /** Mirrors `First.__ts2hxInit` to prove ordered multi-module retention. */
  @:keep
  @:noCompletion
  @:genes.compilerInternal
  public static final __ts2hxInit:Bool = true;
}
