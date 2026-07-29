package react_flight;

import genes.react.Node;
import genes.react.flight.v19.FlightArrayBuffer;
import genes.react.flight.v19.FlightDate;
import genes.react.flight.v19.FlightFloat32Array;
import genes.react.flight.v19.FlightFloat64Array;
import genes.react.flight.v19.FlightGlobalSymbol;
import genes.react.flight.v19.FlightInt16Array;
import genes.react.flight.v19.FlightInt32Array;
import genes.react.flight.v19.FlightInt8Array;
import genes.react.flight.v19.FlightMap;
import genes.react.flight.v19.FlightSet;
import genes.react.flight.v19.FlightUint16Array;
import genes.react.flight.v19.FlightUint32Array;
import genes.react.flight.v19.FlightUint8Array;
import genes.react.flight.v19.FlightUint8ClampedArray;
import genes.ts.Undefinable;
import genes.ts.Unknown;

enum abstract Priority(String) {
  final Normal = "normal";
  final Urgent = "urgent";
}

/**
 * Representative React Flight record shared by any React host.
 *
 * It covers every versioned runtime capability plus ordinary closed values,
 * React composition, null/undefined, and a host-proven nested resource.
 */
typedef AcceptedPayload = {
  final title: String;
  final count: Int;
  final ratio: Float;
  final active: Bool;
  final priority: Priority;
  final optional: Null<String>;
  final absent: Undefinable<Int>;
  final tags: Array<String>;
  final child: Node;
  final createdAt: FlightDate;
  final bytes: FlightArrayBuffer;
  final int8: FlightInt8Array;
  final int16: FlightInt16Array;
  final int32: FlightInt32Array;
  final uint8: FlightUint8Array;
  final uint8Clamped: FlightUint8ClampedArray;
  final uint16: FlightUint16Array;
  final uint32: FlightUint32Array;
  final float32: FlightFloat32Array;
  final float64: FlightFloat64Array;
  final labels: FlightSet<String>;
  final entries: FlightMap<String, Int>;
  final marker: FlightGlobalSymbol;
  final resource: HostResource<{final id: String;}>;
  final action: HostAction<String->Void>;
}

typedef RawPromisePayload = {
  final resource: js.lib.Promise<String>;
}

typedef RawDatePayload = {
  final createdAt: js.lib.Date;
}

typedef RawMapPayload = {
  final entries: js.lib.Map<String, Int>;
}

typedef RawSetPayload = {
  final labels: js.lib.Set<String>;
}

typedef RawArrayBufferPayload = {
  final bytes: js.lib.ArrayBuffer;
}

typedef RawTypedArrayPayload = {
  final bytes: js.lib.Uint8Array;
}

typedef InvalidNestedResource = {
  final resource: HostResource<{final callback: Void->Void;}>;
}

typedef CyclicHostCapability = {
  final resource: HostLoop;
}

typedef RawSymbolPayload = {
  final marker: js.lib.Symbol;
}

typedef FunctionPayload = {
  final callback: Void->Void;
}

class RuntimeRecord {
  public function new() {}
}

typedef ClassPayload = {
  final record: RuntimeRecord;
}

typedef DynamicPayload = {
  final value: Dynamic;
}

typedef UnknownPayload = {
  final value: Unknown;
}

enum RuntimeChoice {
  First;
  Second;
}

typedef EnumPayload = {
  final choice: RuntimeChoice;
}

typedef RecursivePayload = {
  final child: Null<RecursivePayload>;
}
