package enumpayload;

import enumpayload.marker.PlannedMarker;

/** Runtime producer whose return type supplies an otherwise unprinted marker. */
class Factory {
  public static function read(): Reduction<Int, Never, Never, PlannedMarker> {
    return Reduction.Reduced(new PlannedMarker("planned"));
  }
}
