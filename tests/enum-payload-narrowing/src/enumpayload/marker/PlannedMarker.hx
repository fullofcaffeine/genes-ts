package enumpayload.marker;

/** Type referenced from `Main.ts` only by the enum-payload boundary plan. */
class PlannedMarker {
  public final label: String;

  public function new(label: String) {
    this.label = label;
  }
}
