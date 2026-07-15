package sideeffectevidence;

/** Negative control: its only reference is in a method removed by full DCE. */
class DeadTarget {
  @:keep
  public static final initialized:Int = Events.values.push("dead");
}
