import type {Coordinates} from "./Coordinates"
import {Register} from "../../genes/Register"

/**
The `Position` interface represents the position of the concerned device at a given time. The position, represented by a `Coordinates` object, comprehends the 2D position of the device, on a spheroid representing the Earth, but also its altitude and its speed.

Documentation [Position](https://developer.mozilla.org/en-US/docs/Web/API/Position) by [Mozilla Contributors](https://developer.mozilla.org/en-US/docs/Web/API/Position$history), licensed under [CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/).

@see <https://developer.mozilla.org/en-US/docs/Web/API/Position>
*/
export type Position = {
	/**
	Returns a `Coordinates` object defining the current location.
	*/
	coords: Coordinates,
	/**
	Returns a `DOMTimeStamp` representing the time at which the location was retrieved.
	*/
	timestamp: number
}
