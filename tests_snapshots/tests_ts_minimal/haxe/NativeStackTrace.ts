import {Register} from "../genes/Register.js"

export type V8CallSite = {
	getColumnNumber: () => number,
	getFileName: () => string,
	getFunctionName: () => string,
	getLineNumber: () => number
}

