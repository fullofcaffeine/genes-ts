package tests;

import genes.ts.Json;
import genes.ts.JsonArray;
import genes.ts.JsonCodec;
import genes.ts.JsonCodec.JsonDecode;
import genes.ts.JsonObject;
import genes.ts.JsonValue;
import genes.ts.Unknown;
import tink.unit.Assert.*;

typedef RetryErrorRecord = {
	final name:String;
	final message:String;
	final retryable:Null<Bool>;
	final statusCode:Null<Int>;
}

@:asserts
class TestJsonValue {
	public function new() {}

	public function testCheckedConstructors() {
		final object:JsonObject = Json.object({
			read: true,
			write: true,
			nested: {
				count: 2,
				label: "ok",
				none: null,
				tags: ["a", "b"]
			}
		});
		final array:JsonArray = Json.array([
			Json.value("x"),
			Json.value(1),
			Json.value(true),
			Json.value(null),
			Json.value({ok: false})
		]);
		final error:RetryErrorRecord = {
			name: "APIError",
			message: "rate limited",
			retryable: null,
			statusCode: 429
		};
		final value:JsonValue = Json.value(error);
		asserts.assert(JsonCodec.stringify(object).indexOf("\"read\":true") != -1);
		asserts.assert(JsonCodec.stringify(array).indexOf("\"x\"") != -1);
		asserts.assert(JsonCodec.stringify(value).indexOf("\"APIError\"") != -1);
		return asserts.done();
	}

	public function testBoundaryNarrowing() {
		asserts.assert(JsonCodec.narrow(Unknown.fromBoundary(js.Syntax.code("({ a: [1, true, null] })"))) != null);
		asserts.assert(JsonCodec.narrow(Unknown.fromBoundary(js.Syntax.code("[\"x\", { y: false }]"))) != null);
		asserts.assert(JsonCodec.narrow(Unknown.fromBoundary(js.Syntax.code("undefined"))) == null);
		asserts.assert(JsonCodec.narrow(Unknown.fromBoundary(js.Syntax.code("function () {}"))) == null);
		asserts.assert(JsonCodec.narrow(Unknown.fromBoundary(Math.NaN)) == null);
		asserts.assert(JsonCodec.narrow(Unknown.fromBoundary(Math.POSITIVE_INFINITY)) == null);
		asserts.assert(JsonCodec.narrow(Unknown.fromBoundary(js.Syntax.code("new Date()"))) == null);
		asserts.assert(JsonCodec.narrow(Unknown.fromBoundary(js.Syntax.code("({ bad: function () {} })"))) == null);
		asserts.assert(JsonCodec.narrow(Unknown.fromBoundary(js.Syntax.code("['ok', undefined]"))) == null);
		return asserts.done();
	}

	public function testParse() {
		switch JsonCodec.parse("{\"a\":[1,true,null]}") {
			case Ok(value):
				asserts.assert(JsonCodec.stringify(value).indexOf("\"a\"") != -1);
			case Error(error):
				asserts.assert(false, error.message);
		}
		switch JsonCodec.parse("{bad") {
			case Ok(_):
				asserts.assert(false);
			case Error(error):
				asserts.assert(error.message.length > 0);
		}
		return asserts.done();
	}
}
