import type {MediaTrackConstraintSet} from "./MediaTrackConstraintSet"
import type {ConstrainLongRange} from "./ConstrainLongRange"
import type {ConstrainDoubleRange} from "./ConstrainDoubleRange"
import type {ConstrainDOMStringParameters} from "./ConstrainDOMStringParameters"
import type {ConstrainBooleanParameters} from "./ConstrainBooleanParameters"
import {Register} from "../../genes/Register"

/**
The `MediaTrackConstraints` dictionary is used to describe a set of capabilities and the value or values each can take on. A constraints dictionary is passed into `applyConstraints()` to allow a script to establish a set of exact (required) values or ranges and/or preferred values or ranges of values for the track, and the most recently-requested set of custom constraints can be retrieved by calling `getConstraints()`.

Documentation [MediaTrackConstraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints) by [Mozilla Contributors](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints$history), licensed under [CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/).

@see <https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints>
*/
export type MediaTrackConstraints = {
	advanced?: MediaTrackConstraintSet[] | null,
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
