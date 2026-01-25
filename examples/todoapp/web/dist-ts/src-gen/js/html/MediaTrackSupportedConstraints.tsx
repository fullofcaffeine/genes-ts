import {Register} from "../../genes/Register"

/**
The `MediaTrackSupportedConstraints` dictionary establishes the list of constrainable properties recognized by the user agent or browser in its implementation of the `MediaStreamTrack` object. An object conforming to `MediaTrackSupportedConstraints` is returned by `MediaDevices.getSupportedConstraints()`.

Documentation [MediaTrackSupportedConstraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSupportedConstraints) by [Mozilla Contributors](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSupportedConstraints$history), licensed under [CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/).

@see <https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSupportedConstraints>
*/
export type MediaTrackSupportedConstraints = {
	/**
	A Boolean value whose value is `true` if the `aspectRatio` constraint is supported in the current environment.
	*/
	aspectRatio?: boolean | null,
	/**
	A Boolean whose value is `true` if the `autoGainControl` constraint is supported in the current environment.
	*/
	autoGainControl?: boolean | null,
	browserWindow?: boolean | null,
	/**
	A Boolean value whose value is `true` if the `channelCount` constraint is supported in the current environment.
	*/
	channelCount?: boolean | null,
	/**
	A Boolean value whose value is `true` if the `deviceId` constraint is supported in the current environment.
	*/
	deviceId?: boolean | null,
	/**
	A Boolean value whose value is `true` if the `echoCancellation` constraint is supported in the current environment.
	*/
	echoCancellation?: boolean | null,
	/**
	A Boolean value whose value is `true` if the `facingMode` constraint is supported in the current environment.
	*/
	facingMode?: boolean | null,
	/**
	A Boolean value whose value is `true` if the `frameRate` constraint is supported in the current environment.
	*/
	frameRate?: boolean | null,
	/**
	A Boolean value whose value is `true` if the `groupId` constraint is supported in the current environment.
	*/
	groupId?: boolean | null,
	/**
	A Boolean value whose value is `true` if the `height` constraint is supported in the current environment.
	*/
	height?: boolean | null,
	/**
	A Boolean value whose value is `true` if the `latency` constraint is supported in the current environment.
	*/
	latency?: boolean | null,
	mediaSource?: boolean | null,
	/**
	A Boolean whose value is `true` if the `noiseSuppression` constraint is supported in the current environment.
	*/
	noiseSuppression?: boolean | null,
	/**
	A Boolean value whose value is `true` if the `sampleRate` constraint is supported in the current environment.
	*/
	sampleRate?: boolean | null,
	/**
	A Boolean value whose value is `true` if the `sampleSize` constraint is supported in the current environment.
	*/
	sampleSize?: boolean | null,
	scrollWithPage?: boolean | null,
	viewportHeight?: boolean | null,
	viewportOffsetX?: boolean | null,
	viewportOffsetY?: boolean | null,
	viewportWidth?: boolean | null,
	/**
	A Boolean value whose value is `true` if the `volume` constraint is supported in the current environment.
	*/
	volume?: boolean | null,
	/**
	A Boolean value whose value is `true` if the `width` constraint is supported in the current environment.
	*/
	width?: boolean | null
}
