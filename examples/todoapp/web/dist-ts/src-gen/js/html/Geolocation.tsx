import type {PositionOptions} from "./PositionOptions"
import type {Position} from "./Position"
import {Register} from "../../genes/Register"

/**
The `Geolocation` interface represents an object able to programmatically obtain the position of the device. It gives Web content access to the location of the device. This allows a Web site or app to offer customized results based on the user's location.

Documentation [Geolocation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation) by [Mozilla Contributors](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation$history), licensed under [CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/).

@see <https://developer.mozilla.org/en-US/docs/Web/API/Geolocation>
*/
export type Geolocation = {
	/**
	Removes the particular handler previously installed using `watchPosition()`.
	*/
	clearWatch: (watchId: number) => void,
	/**
	Determines the device's current location and gives back a `Position` object with the data.
	@throws DOMError
	*/
	getCurrentPosition: (successCallback: ((arg0: Position) => void), errorCallback?: ((arg0: PositionError) => void), options?: PositionOptions) => void,
	/**
	Returns a `long` value representing the newly established callback function to be invoked whenever the device location changes.
	@throws DOMError
	*/
	watchPosition: (successCallback: ((arg0: Position) => void), errorCallback?: ((arg0: PositionError) => void), options?: PositionOptions) => number
}
