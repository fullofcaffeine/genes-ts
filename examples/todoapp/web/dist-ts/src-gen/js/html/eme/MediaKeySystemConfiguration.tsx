import type {MediaKeySystemMediaCapability} from "./MediaKeySystemMediaCapability"
import {Register} from "../../../genes/Register"

/**
The `MediaKeySystemConfiguration` interface Encrypted Media Extensions API provides configuration information about the media key system.

Documentation [MediaKeySystemConfiguration](https://developer.mozilla.org/en-US/docs/Web/API/MediaKeySystemConfiguration) by [Mozilla Contributors](https://developer.mozilla.org/en-US/docs/Web/API/MediaKeySystemConfiguration$history), licensed under [CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/).

@see <https://developer.mozilla.org/en-US/docs/Web/API/MediaKeySystemConfiguration>
*/
export type MediaKeySystemConfiguration = {
	/**
	Returns a list of supported audio type and capability pairs.
	*/
	audioCapabilities?: MediaKeySystemMediaCapability[] | null,
	/**
	Indicates whether a persistent distinctive identifier is required.
	*/
	distinctiveIdentifier?: string | null,
	/**
	Returns a list of supported initialization data type names. An initialization data type is a string indicating the format of the initialization data.
	*/
	initDataTypes?: string[] | null,
	label?: string | null,
	/**
	Indicates whether the ability to persist state is required.
	*/
	persistentState?: string | null,
	sessionTypes?: string[] | null,
	/**
	Returns a list of supported video type and capability pairs.
	*/
	videoCapabilities?: MediaKeySystemMediaCapability[] | null
}
