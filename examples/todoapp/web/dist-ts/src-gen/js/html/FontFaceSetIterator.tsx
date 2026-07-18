import {Register} from "../../genes/Register"
import type {FontFaceSetIteratorResult} from "./FontFaceSetIteratorResult"

export type FontFaceSetIterator = {
	/**
	 * @throws DOMError
	 */
	next: () => FontFaceSetIteratorResult
}
