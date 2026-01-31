import {Register} from "../../../genes/Register"

export type ContextAttributes = {
	alpha?: boolean | null,
	antialias?: boolean | null,
	depth?: boolean | null,
	failIfMajorPerformanceCaveat?: boolean | null,
	powerPreference?: string | null,
	premultipliedAlpha?: boolean | null,
	preserveDrawingBuffer?: boolean | null,
	stencil?: boolean | null
}
