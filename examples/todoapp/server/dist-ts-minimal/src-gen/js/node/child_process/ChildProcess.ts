import {Register} from "../../../genes/Register.js"

export type ChildProcessSendOptions = {
	/**
	Can be used when passing instances of `js.node.net.Socket`.

	When true, the socket is kept open in the sending process.

	Defaults to false.
	*/
	keepOpen?: boolean | null
}
