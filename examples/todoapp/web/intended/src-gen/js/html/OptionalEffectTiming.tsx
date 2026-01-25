import {Register} from "../../genes/Register"

export type OptionalEffectTiming = {
	delay?: number | null,
	direction?: string | null,
	duration?: number | string | null,
	easing?: string | null,
	endDelay?: number | null,
	fill?: string | null,
	iterationStart?: number | null,
	iterations?: number | null
}
