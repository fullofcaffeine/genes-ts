import {Register} from "../../genes/Register"

export type TouchInit = {
	clientX?: number | null,
	clientY?: number | null,
	force?: number | null,
	identifier: number,
	pageX?: number | null,
	pageY?: number | null,
	radiusX?: number | null,
	radiusY?: number | null,
	rotationAngle?: number | null,
	screenX?: number | null,
	screenY?: number | null,
	target: EventTarget
}
