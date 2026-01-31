import {Register} from "../genes/Register"

export type V8CallSite = {
	getColumnNumber: () => number,
	getFileName: () => string,
	getFunctionName: () => string,
	getLineNumber: () => number
}
