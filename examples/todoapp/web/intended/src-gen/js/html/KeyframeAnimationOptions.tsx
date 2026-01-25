import {Register} from "../../genes/Register"

export type KeyframeAnimationOptions = {
	composite?: string | null,
	/**
	The number of milliseconds to delay the start of the animation. Defaults to 0.
	*/
	delay?: number | null,
	/**
	Whether the animation runs forwards (`normal`), backwards (`reverse`), switches direction after each iteration (`alternate`), or runs backwards and switches direction after each iteration (`alternate-reverse`). Defaults to `"normal"`.
	*/
	direction?: string | null,
	/**
	The number of milliseconds each iteration of the animation takes to complete. Defaults to 0. Although this is technically optional, keep in mind that your animation will not run if this value is 0.
	*/
	duration?: number | string | null,
	/**
	The rate of the animation's change over time. Accepts the pre-defined values `"linear"`, `"ease"`, `"ease-in"`, `"ease-out"`, and `"ease-in-out"`, or a custom `"cubic-bezier"` value like `"cubic-bezier(0.42, 0, 0.58, 1)"`. Defaults to `"linear"`.
	*/
	easing?: string | null,
	/**
	The number of milliseconds to delay after the end of an animation. This is primarily of use when sequencing animations based on the end time of another animation. Defaults to 0. 
	*/
	endDelay?: number | null,
	/**
	Dictates whether the animation's effects should be reflected by the element(s) prior to playing (`"backwards"`), retained after the animation has completed playing (`"forwards"`), or `both`. Defaults to `"none"`.
	*/
	fill?: string | null,
	id?: string | null,
	iterationComposite?: string | null,
	/**
	Describes at what point in the iteration the animation should start. 0.5 would indicate starting halfway through the first iteration for example, and with this value set, an animation with 2 iterations would end halfway through a third iteration. Defaults to 0.0.
	*/
	iterationStart?: number | null,
	/**
	The number of times the animation should repeat. Defaults to `1`, and can also take a value of `Infinity` to make it repeat for as long as the element exists.
	*/
	iterations?: number | null
}
