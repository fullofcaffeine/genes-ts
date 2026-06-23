import {Register} from "../genes/Register.js"

export type FixtureServerShape = {
	closeAllConnections?: ((() => void)) | null,
	off: (event: string, handler: ((arg0: string) => void)) => void
}

export class ServerCallbacks {
	static callbackInitializedLater(server: FixtureServerShape): void {
		let fail: ((arg0: string) => void) = null!;
		let cleanup: (() => void) = function () {
			server.off("error", fail);
		};
		fail = function (error: string) {
			cleanup();
			console.log("tests/genes-ts/snapshot/basic/src/foo/ServerCallbacks.hx:19:",error);
		};
	}
	static optionalForwardedMethod(server: FixtureServerShape): void {
		let closeAllConnections: ((() => void)) | null = Register.bind(server, server.closeAllConnections);
		if (closeAllConnections != null) {
			closeAllConnections();
		};
	}
	static get __name__(): string {
		return "foo.ServerCallbacks"
	}
	get __class__(): Function {
		return ServerCallbacks
	}
}
Register.setHxClass("foo.ServerCallbacks", ServerCallbacks);
