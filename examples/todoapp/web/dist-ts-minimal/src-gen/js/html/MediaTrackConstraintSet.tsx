import {Register} from "../../genes/Register"
import type {ConstrainBooleanParameters} from "./ConstrainBooleanParameters"
import type {ConstrainLongRange} from "./ConstrainLongRange"
import type {ConstrainDOMStringParameters} from "./ConstrainDOMStringParameters"
import type {ConstrainDoubleRange} from "./ConstrainDoubleRange"

export type MediaTrackConstraintSet = {
	autoGainControl?: boolean | ConstrainBooleanParameters | null,
	browserWindow?: number | null,
	channelCount?: number | ConstrainLongRange | null,
	deviceId?: string | string[] | ConstrainDOMStringParameters | null,
	echoCancellation?: boolean | ConstrainBooleanParameters | null,
	facingMode?: string | string[] | ConstrainDOMStringParameters | null,
	frameRate?: number | ConstrainDoubleRange | null,
	height?: number | ConstrainLongRange | null,
	mediaSource?: string | null,
	noiseSuppression?: boolean | ConstrainBooleanParameters | null,
	scrollWithPage?: boolean | null,
	viewportHeight?: number | ConstrainLongRange | null,
	viewportOffsetX?: number | ConstrainLongRange | null,
	viewportOffsetY?: number | ConstrainLongRange | null,
	viewportWidth?: number | ConstrainLongRange | null,
	width?: number | ConstrainLongRange | null
}
