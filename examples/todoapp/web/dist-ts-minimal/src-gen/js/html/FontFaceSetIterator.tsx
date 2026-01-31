import type {FontFaceSetIteratorResult} from "./FontFaceSetIteratorResult"
import {Register} from "../../genes/Register"

export type FontFaceSetIterator = {
	/**
	@throws DOMError
	*/
	next: () => FontFaceSetIteratorResult
}
