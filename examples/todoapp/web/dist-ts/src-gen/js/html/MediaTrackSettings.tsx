import {Register} from "../../genes/Register"

/**
The `MediaTrackSettings` dictionary is used to return the current values configured for each of a `MediaStreamTrack`'s settings. These values will adhere as closely as possible to any constraints previously described using a `MediaTrackConstraints` object and set using `applyConstraints()`, and will adhere to the default constraints for any properties whose constraints haven't been changed, or whose customized constraints couldn't be matched.

Documentation [MediaTrackSettings](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings) by [Mozilla Contributors](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings$history), licensed under [CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/).

@see <https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings>
*/
export type MediaTrackSettings = {
	/**
	A Boolean which indicates the current value of the `MediaTrackConstraints.autoGainControl` property, which is `true` if automatic gain control is enabled and is `false` otherwise.
	*/
	autoGainControl?: boolean | null,
	browserWindow?: number | null,
	/**
	A long integer value indicating the current value of the ``MediaTrackConstraints.channelCount`` property, specifying the number of audio channels present on the track (therefore indicating how many audio samples exist in each audio frame). This is 1 for mono, 2 for stereo, and so forth.
	*/
	channelCount?: number | null,
	/**
	A `DOMString` indicating the current value of the ``MediaTrackConstraints.deviceId`` property. The device ID is a origin-unique string identifying the source of the track; this is usually a `GUID`. This value is specific to the source of the track's data and is not usable for setting constraints; it can, however, be used for initially selecting media when calling `MediaDevices.getUserMedia()`.
	*/
	deviceId?: string | null,
	/**
	A Boolean indicating the current value of the ``MediaTrackConstraints.echoCancellation`` property, specifying `true` if echo cancellation is enabled, otherwise `false`.
	*/
	echoCancellation?: boolean | null,
	/**

	*/
	facingMode?: string | null,
	/**
	A double-precision floating point value indicating the current value of the ``MediaTrackConstraints.frameRate`` property, specifying how many frames of video per second the track includes. If the value can't be determined for any reason, the value will match the vertical sync rate of the device the user agent is running on.
	*/
	frameRate?: number | null,
	/**
	A long integer value indicating the current value of the ``MediaTrackConstraints.height`` property, specifying the height of the track's video data in pixels.
	*/
	height?: number | null,
	mediaSource?: string | null,
	/**
	A Boolean which indicates the current value of the `MediaTrackConstraints.noiseSuppression` property, which is `true` if noise suppression is enabled and is `false` otherwise.
	*/
	noiseSuppression?: boolean | null,
	scrollWithPage?: boolean | null,
	viewportHeight?: number | null,
	viewportOffsetX?: number | null,
	viewportOffsetY?: number | null,
	viewportWidth?: number | null,
	/**
	A long integer value indicating the current value of the `MediaTrackSettings.width` property, specifying the width of the track's video data in pixels.
	*/
	width?: number | null
}
