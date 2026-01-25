import {Register} from "../../../genes/Register.js"

/**
Options for `Readable` private constructor.
For stream implementors only, see node.js API documentation
*/
export type ReadableNewOptions = {
	destroy?: (((arg0: Error | null, arg1: ((arg0: Error | null) => void)) => void)) | null,
	encoding?: string | null,
	highWaterMark?: number | null,
	objectMode?: boolean | null,
	read?: (((arg0: number) => void)) | null
}
