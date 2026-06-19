package foo;

import genes.ts.Undefinable;
import genes.ts.Unknown;
import haxe.DynamicAccess;

typedef UnknownRecord = DynamicAccess<Unknown>;
typedef MaybeName = Undefinable<String>;
typedef MaybeNameRecord = {
  final name: MaybeName;
}

typedef OptionalArrayRecord = {
  @:optional final items:Array<String>;
}

class BoundaryTypes {
  public static function unknownValue<T>(value:T):Unknown {
    return Unknown.fromBoundary(value);
  }

  public static function missingName():MaybeName {
    return Undefinable.absent();
  }

  public static function presentName():MaybeName {
    return "Ada";
  }

  public static function missingRecord():MaybeNameRecord {
    return {
      name: Undefinable.absent()
    };
  }

  public static function chooseName(present:Bool):MaybeName {
    return present ? "Ada" : Undefinable.absent();
  }

  public static function normalize(value:MaybeName):Null<String> {
    return value.orNull();
  }

  public static function record(value:Unknown):UnknownRecord {
    final out = new DynamicAccess<Unknown>();
    out.set("payload", value);
    return out;
  }

  public static function copyOptionalItems(record:OptionalArrayRecord):Array<String> {
    return record.items == null ? [] : record.items.copy();
  }

  public static function joinOptionalItems(record:OptionalArrayRecord):String {
    final out:Array<String> = [];
    if (record.items != null) {
      for (item in record.items)
        out.push(item.toUpperCase());
    }
    return out.join(",");
  }

  public static function demo():String {
    final present = normalize(presentName());
    final missing = normalize(missingName());
    final recordMissing = normalize(missingRecord().name);
    final chosenMissing = normalize(chooseName(false));
    final payload = record(unknownValue("typed boundary"));
    final payloadStatus = payload.exists("payload") ? "payload" : "missing";
    final optionalCopy = copyOptionalItems({items: ["a", "b"]}).join("");
    final optionalJoin = joinOptionalItems({items: ["c", "d"]});
    return (present == null ? "none" : present) + ":" + (missing == null ? "none" : missing) + ":" + (recordMissing == null ? "none" : recordMissing) + ":" + (chosenMissing == null ? "none" : chosenMissing) + ":" + payloadStatus + ":" + optionalCopy + ":" + optionalJoin;
  }
}
