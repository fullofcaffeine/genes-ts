import {Register} from "../../genes/Register"

export type OptionalEffectTiming = {
	delay?: number | null,
	direction?: "alternate" | "alternate-reverse" | "normal" | "reverse" | null,
	duration?: number | string | null,
	easing?: string | null,
	endDelay?: number | null,
	fill?: "auto" | "backwards" | "both" | "forwards" | "none" | null,
	iterationStart?: number | null,
	iterations?: number | null
}
