import type {MediaTrackConstraints} from "./MediaTrackConstraints"
import {Register} from "../../genes/Register"

/**
The `MediaStreamConstraints` dictionary is used when calling `getUserMedia()` to specify what kinds of tracks should be included in the returned `MediaStream`, and, optionally, to establish constraints for those tracks' settings.

Documentation [MediaStreamConstraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamConstraints) by [Mozilla Contributors](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamConstraints$history), licensed under [CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/).

@see <https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamConstraints>
*/
export type MediaStreamConstraints = {
	/**
	Either a Boolean (which indicates whether or not an audio track is requested) or a `MediaTrackConstraints` object providing the constraints which must be met by the audio track included in the returned `MediaStream`. If constraints are specified, an audio track is inherently requested.
	*/
	audio?: boolean | MediaTrackConstraints | null,
	fake?: boolean | null,
	/**
	A `DOMString` identifying the peer who has sole access to the stream. If this property is specified, only the indicated peer can receive and use the stream. Streams isolated in this way can only be displayed in a media element (`audio` or `video`) where the content is protected just as if `CORS` cross-origin rules were in effect. When a peer identity is set, `MediaStreamTrack`s from that peer have their `MediaStreamTrack.isolated` flag set to `true`.
	*/
	peerIdentity?: string | null,
	picture?: boolean | null,
	/**
	Either a Boolean (which indicates whether or not a video track is requested) or a `MediaTrackConstraints` object providing the constraints which must be met by the video track included in the returned `MediaStream`. If constraints are specified, a video track is inherently requested.
	*/
	video?: boolean | MediaTrackConstraints | null
}
