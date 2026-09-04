package tests;

import tink.unit.Assert.*;
import tests.typeonly.DeclarationOnlyShape;
import tests.typeonly.JsonCacheInvalidation.JsonCacheInvalidationPayload;
import tests.typeonly.JsonCacheInvalidation;
import tests.typeonly.TypeOnlyHelper;

class TypeOnlyApi {
  public function new() {}

  // Type-only dependency: TS output must still be able to import this type
  // even if Haxe DCE removes the module from runtime output.
  public function getHelper(): TypeOnlyHelper {
    return null;
  }

  public function getShape(): DeclarationOnlyShape {
    return {label: "declaration-only"};
  }

  public function getJsonPayload(): JsonCacheInvalidationPayload {
    return null;
  }
}

class TestTypeOnlyDce {
  public function new() {}

  public function testTypeOnlyDce() {
    JsonCacheInvalidation.touch();
    final api = new TypeOnlyApi();
    api.getHelper();
    return assert(api.getShape().label == "declaration-only");
  }
}
