package foo;

import genes.ts.Undefinable;
import genes.ts.Unknown;
import genes.ts.UnknownArray;
import genes.ts.UnknownNarrow;
import genes.ts.UnknownRecord;
import haxe.DynamicAccess;
import haxe.extern.EitherType;

typedef UnknownMap = DynamicAccess<Unknown>;
typedef MaybeName = Undefinable<String>;

typedef MaybeNameRecord = {
  final name: MaybeName;
}

typedef MutableMaybeNameRecord = {
  var name: MaybeName;
}

typedef OptionalMaybeNameRecord = {
  @:optional var name: MaybeName;
}

typedef OptionalDirectUndefinableRecord = {
  @:optional var name: Undefinable<String>;
}

typedef MaybeFlagRecord = {
  final enabled: Undefinable<Bool>;
}

typedef MaybeFlagBridgeShape = {
  final enabled: Undefinable<Bool>;
}

/**
 * Fixture for raw TypeScript type overrides on abstracts that still carry a
 * typed Haxe anonymous shape underneath.
 */
@:forward(enabled)
@:ts.type("{ enabled: boolean | undefined }")
abstract MaybeFlagBridge(MaybeFlagBridgeShape) from MaybeFlagBridgeShape
  to MaybeFlagBridgeShape {}

typedef OptionalArrayRecord = {
  @:optional final items: Array<String>;
}

typedef OptionalNameRecord = {
  @:optional final label: String;
}

typedef OptionalNameChild = {
  @:optional final label: String;
}

typedef OptionalNestedNameRecord = {
  @:optional final child: OptionalNameChild;
}

typedef NativeFunctionPayload = {
  final name: String;
  final arguments: String;
}

typedef NativeOptionalPayload = {
  final description: Undefinable<String>;
}

typedef OptionalWarning = {
  final feature: String;
}

typedef OptionalWarningsRecord = {
  final warnings: Undefinable<Array<OptionalWarning>>;
}

/**
 * Fixture for Haxe-safe aliases over external JavaScript property names.
 *
 * `function` is a TypeScript/JavaScript keyword, so Haxe source uses `fn`.
 * `@:native("function")` requires generated TS types, object literals, and
 * field access to use the runtime property name while Haxe keeps typechecking
 * against the safe alias.
 */
typedef NativeFunctionRecord = {
  @:native("function")
  final fn: NativeFunctionPayload;
}

typedef NativeOptionalRecord = {
  @:native("function")
  final fn: NativeOptionalPayload;
}

typedef NativeFunctionChoice = EitherType<String, NativeFunctionRecord>;

class BoundaryTypes {
  public static function unknownValue<T>(value: T): Unknown {
    return Unknown.fromBoundary(value);
  }

  public static function missingName(): MaybeName {
    return Undefinable.absent();
  }

  public static function presentName(): MaybeName {
    return "Ada";
  }

  public static function missingRecord(): MaybeNameRecord {
    return {
      name: Undefinable.absent()
    };
  }

  public static function localMissingName(): MaybeName {
    var name: MaybeName = Undefinable.absent();
    return name;
  }

  public static function chooseName(present: Bool): MaybeName {
    return present ? "Ada" : Undefinable.absent();
  }

  public static function assignMissingName(): MutableMaybeNameRecord {
    final out: MutableMaybeNameRecord = {name: "Ada"};
    out.name = Undefinable.absent();
    return out;
  }

  public static function assignChosenName(present: Bool): MutableMaybeNameRecord {
    final out: MutableMaybeNameRecord = {name: Undefinable.absent()};
    out.name = present ? "Ada" : Undefinable.absent();
    return out;
  }

  public static function conditionalFlagRecord(present: Bool): MaybeFlagRecord {
    final enabled: Null<Bool> = present ? true : null;
    return {
      enabled: enabled == null ? Undefinable.absent() : enabled
    };
  }

  public static function conditionalFlagBridge(present: Bool): MaybeFlagBridge {
    final enabled: Null<Bool> = present ? true : null;
    return {
      enabled: enabled == null ? Undefinable.absent() : enabled
    };
  }

  public static function optionalMissingName(): OptionalMaybeNameRecord {
    final out: OptionalMaybeNameRecord = {};
    out.name = Undefinable.absent();
    return out;
  }

  public static function optionalDirectMissingName(): OptionalDirectUndefinableRecord {
    final out: OptionalDirectUndefinableRecord = {};
    out.name = Undefinable.absent();
    return out;
  }

  public static function normalize(value: MaybeName): Null<String> {
    return value.orNull();
  }

  public static function guardedName(value: Null<String>): MaybeName {
    if (value == null)
      return Undefinable.absent();
    final present: String = value;
    return present;
  }

  public static function guardedUpper(value: Null<String>): String {
    if (value != null) {
      final present: String = value;
      return present.toUpperCase();
    }
    return "missing";
  }

  public static function guardedCall(value: Null<String>): String {
    if (value != null)
      return consumeName(value);
    return "missing";
  }

  public static function record(value: Unknown): UnknownMap {
    final out = new DynamicAccess<Unknown>();
    out.set("payload", value);
    return out;
  }

  public static function narrowString(value: Unknown): Null<String> {
    return UnknownNarrow.string(value);
  }

  public static function narrowBool(value: Unknown): Null<Bool> {
    return UnknownNarrow.bool(value);
  }

  public static function narrowFinite(value: Unknown): Null<Float> {
    return UnknownNarrow.finiteNumber(value);
  }

  public static function narrowInt32(value: Unknown): Null<Int> {
    return UnknownNarrow.int32(value);
  }

  public static function narrowArray(value: Unknown): Null<UnknownArray> {
    return UnknownNarrow.array(value);
  }

  public static function narrowRecord(value: Unknown): Null<UnknownRecord> {
    return UnknownNarrow.record(value);
  }

  public static function decodeRecordSummary(value: Unknown): String {
    final record = UnknownNarrow.record(value);
    if (record == null)
      return "missing-record";

    final name = UnknownNarrow.string(record.get("name"));
    final keys = record.keys().join(",");
    return (name == null ? "missing-name" : name)
      + ":"
      + (record.hasOwn("age") ? "age" : "no-age")
      + ":"
      + keys;
  }

  public static function decodeArraySummary(value: Unknown): String {
    final array = UnknownNarrow.array(value);
    if (array == null)
      return "missing-array";

    final first = array.length == 0 ? null : UnknownNarrow.string(array.get(0));
    return (first == null ? "missing-first" : first)
      + ":"
      + ("" + array.length);
  }

  public static function copyOptionalItems(record: OptionalArrayRecord): Array<String> {
    return record.items == null ? [] : record.items.copy();
  }

  public static function joinOptionalItems(record: OptionalArrayRecord): String {
    final out: Array<String> = [];
    if (record.items != null) {
      for (item in record.items)
        out.push(item.toUpperCase());
    }
    return out.join(",");
  }

  public static function guardedOptionalItemsCall(record: OptionalArrayRecord): String {
    if (record.items != null)
      return consumeItems(record.items);
    return "missing";
  }

  public static function labelOrFallback(record: OptionalNameRecord): String {
    return record.label == null
      || record.label == "" ? "fallback" : record.label;
  }

  public static function nullableLabel(value: Null<String>): String {
    return value == null ? "missing" : value;
  }

  static function consumeName(value: String): String {
    return value.toUpperCase();
  }

  static function consumeItems(value: Array<String>): String {
    return value.join(",");
  }

  public static function optionalLabelViaNullableParam(record: OptionalNameRecord): String {
    return nullableLabel(record.label);
  }

  public static function optionalNestedLabelViaNullableParam(record: OptionalNestedNameRecord): String {
    return nullableLabel(record.child.label);
  }

  public static function nativeFunctionRecord(): NativeFunctionRecord {
    return {
      fn: {
        name: "lookup",
        arguments: "{}"
      }
    };
  }

  public static function nativeFunctionRecords(): Array<NativeFunctionRecord> {
    return [
      {
        fn: {
          name: "array_lookup",
          arguments: "{\"id\":1}"
        }
      }
    ];
  }

  public static function nativeFunctionRecordsViaPush(): Array<NativeFunctionRecord> {
    final out: Array<NativeFunctionRecord> = [];
    out.push({
      fn: {
        name: "push_lookup",
        arguments: "{\"id\":2}"
      }
    });
    return out;
  }

  public static function nativeFunctionChoiceObject(): NativeFunctionChoice {
    return {
      fn: {
        name: "choice_lookup",
        arguments: "{\"id\":3}"
      }
    };
  }

  public static function nativeFunctionSummary(record: NativeFunctionRecord): String {
    return record.fn.name + ":" + record.fn.arguments;
  }

  public static function nativeOptionalRecord(): NativeOptionalRecord {
    return {
      fn: {
        description: "typed native"
      }
    };
  }

  public static function nativeOptionalDescription(record: NativeOptionalRecord): Null<String> {
    return record.fn.description.orNull();
  }

  public static function nativeOptionalDescriptionPresent(record: NativeOptionalRecord): Bool {
    return record.fn.description.orNull() != null;
  }

  public static function firstWarningFeature(record: OptionalWarningsRecord): String {
    return record.warnings.orNull()[0].feature;
  }

  public static function demo(): String {
    final present = normalize(presentName());
    final missing = normalize(missingName());
    final recordMissing = normalize(missingRecord().name);
    final localMissing = normalize(localMissingName());
    final chosenMissing = normalize(chooseName(false));
    final assignedMissing = normalize(assignMissingName().name);
    final assignedChosen = normalize(assignChosenName(false).name);
    final conditionalFlag = conditionalFlagRecord(false).enabled.orNull();
    final bridgeFlag = conditionalFlagBridge(false).enabled.orNull();
    final optionalMissing = normalize(optionalMissingName().name);
    final optionalDirectMissing = normalize(optionalDirectMissingName().name);
    final guardedPresent = normalize(guardedName("Ada"));
    final guardedMissing = normalize(guardedName(null));
    final guardedUpper = guardedUpper("ada");
    final guardedCallValue = guardedCall("ada");
    final payload = record(unknownValue("typed boundary"));
    final payloadStatus = payload.exists("payload") ? "payload" : "missing";
    final narrowedString = narrowString(unknownValue("typed"));
    final narrowedBool = narrowBool(unknownValue(true));
    final narrowedFinite = narrowFinite(unknownValue(12.5));
    final narrowedInt = narrowInt32(unknownValue(37));
    final narrowedRecord = decodeRecordSummary(unknownValue({name: "Grace",
      age: 37}));
    final narrowedArray = decodeArraySummary(unknownValue(["first", "second"]));
    final nullStatus = UnknownNarrow.isNull(unknownValue(null)) ? "null" : "not-null";
    final undefinedStatus = UnknownNarrow.isUndefined(Unknown.fromBoundary(Undefinable.absent())) ? "undefined" : "defined";
    final optionalCopy = copyOptionalItems({items: ["a", "b"]}).join("");
    final optionalJoin = joinOptionalItems({items: ["c", "d"]});
    final optionalItemsCall = guardedOptionalItemsCall({items: ["e", "f"]});
    final optionalLabel = labelOrFallback({label: "typed"});
    final optionalParamLabel = optionalLabelViaNullableParam({});
    final optionalNestedParamLabel = optionalNestedLabelViaNullableParam({child: {}});
    final nativeFunction = nativeFunctionSummary(nativeFunctionRecord());
    final nativeArrayFunction = nativeFunctionSummary(nativeFunctionRecords()[0]);
    final nativePushFunction = nativeFunctionSummary(nativeFunctionRecordsViaPush()[0]);
    final nativeChoice = nativeFunctionChoiceObject() == null ? "missing" : "choice";
    final nativeOptional = nativeOptionalDescription(nativeOptionalRecord());
    final nativeOptionalPresent = nativeOptionalDescriptionPresent(nativeOptionalRecord());
    final warningFeature = firstWarningFeature({warnings: [{feature: "topK"}]});
    return (present == null ? "none" : present)
      + ":"
      + (missing == null ? "none" : missing)
      + ":"
      + (recordMissing == null ? "none" : recordMissing)
      + ":"
      + (localMissing == null ? "none" : localMissing)
      + ":"
      + (chosenMissing == null ? "none" : chosenMissing)
      + ":"
      + (assignedMissing == null ? "none" : assignedMissing)
      + ":"
      + (assignedChosen == null ? "none" : assignedChosen)
      + ":"
      + (conditionalFlag == null ? "none" : conditionalFlag ? "true" : "false")
      + ":"
      + (bridgeFlag == null ? "none" : bridgeFlag ? "true" : "false")
      + ":"
      + (optionalMissing == null ? "none" : optionalMissing)
      + ":"
      + (optionalDirectMissing == null ? "none" : optionalDirectMissing)
      + ":"
      + (guardedPresent == null ? "none" : guardedPresent)
      + ":"
      + (guardedMissing == null ? "none" : guardedMissing)
      + ":"
      + guardedUpper
      + ":"
      + guardedCallValue
      + ":"
      + payloadStatus
      + ":"
      + (narrowedString == null ? "none" : narrowedString)
      + ":"
      + (narrowedBool == null ? "none" : narrowedBool ? "true" : "false")
      + ":"
      + (narrowedFinite == null ? "none" : "" + narrowedFinite)
      + ":"
      + (narrowedInt == null ? "none" : "" + narrowedInt)
      + ":"
      + narrowedRecord
      + ":"
      + narrowedArray
      + ":"
      + nullStatus
      + ":"
      + undefinedStatus
      + ":"
      + optionalCopy
      + ":"
      + optionalJoin
      + ":"
      + optionalItemsCall
      + ":"
      + optionalLabel
      + ":"
      + optionalParamLabel
      + ":"
      + optionalNestedParamLabel
      + ":"
      + nativeFunction
      + ":"
      + nativeArrayFunction
      + ":"
      + nativePushFunction
      + ":"
      + nativeChoice
      + ":"
      + (nativeOptional == null ? "none" : nativeOptional)
      + ":"
      + (nativeOptionalPresent ? "present" : "missing")
      + ":"
      + warningFeature;
  }
}
