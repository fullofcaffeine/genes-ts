package foo;

typedef FixtureServerShape = {
	function off(event:String, handler:String->Void):Void;
	@:optional function closeAllConnections():Void;
}

@:forward(off, closeAllConnections)
abstract FixtureServer(FixtureServerShape) from FixtureServerShape to FixtureServerShape {}

class ServerCallbacks {
	public static function callbackInitializedLater(server:FixtureServer):Void {
		var fail:String->Void = null;
		function cleanup():Void {
			server.off("error", fail);
		}
		fail = error -> {
			cleanup();
			trace(error);
		};
	}

	public static function optionalForwardedMethod(server:FixtureServer):Void {
		final closeAllConnections = server.closeAllConnections;
		if (closeAllConnections != null)
			closeAllConnections();
	}
}
