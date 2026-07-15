package dual;

import genes.ts.Undefinable;
import genes.ts.Unknown;
import genes.ts.UnknownNarrow;

/**
 * Exercises genes-ts helper abstractions through both current output modes.
 *
 * Every `Unknown` value is narrowed immediately and every `Undefinable` value
 * is observed through an exact runtime predicate, so the fixture proves the
 * helper boundary without turning broad values into a domain model.
 */
class HelperScenario {
  public static function run():Array<String> {
    final events:Array<String> = [];
    final absent:Undefinable<String> = Undefinable.absent();
    events.push('undefined:${UnknownNarrow.isUndefined(Unknown.fromBoundary(absent))}');

    final boundary = Unknown.fromBoundary({name: "Ada"});
    final record = UnknownNarrow.record(boundary);
    final name = record == null ? null : UnknownNarrow.string(record.get("name"));
    events.push('unknown-record:$name');

    final array = UnknownNarrow.array(Unknown.fromBoundary(["first", "second"]));
    events.push('unknown-array:${array == null ? -1 : array.length}');

    final report = DualApi.summarize(["Ada", "Grace"]);
    events.push('api:${report.count}:${report.first}:${UnknownNarrow.isUndefined(Unknown.fromBoundary(report.missing))}');
    events.push('type-only:${DualApi.typeOnly() == null}');
    return events;
  }
}
