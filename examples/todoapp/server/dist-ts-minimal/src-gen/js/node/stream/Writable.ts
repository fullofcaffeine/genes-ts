import {Register} from "../../../genes/Register.js"

/**
Options for `Writable` private constructor.
For stream implementors only, see node.js API documentation
*/
export type WritableNewOptions = {
	decodeStrings?: boolean | null,
	defaultEncoding?: string | null,
	destroy?: (((arg0: Error | null, arg1: ((arg0: Error | null) => void)) => void)) | null,
	emitClose?: boolean | null,
	highWaterMark?: number | null,
	objectMode?: boolean | null,
	write?: (((arg0: any, arg1: string, arg2: ((arg0: Error | null) => void)) => void)) | null,
	writev?: (((arg0: {
		chunk: any,
		encoding: string
	}[], arg1: ((arg0: Error | null) => void)) => void)) | null
}
