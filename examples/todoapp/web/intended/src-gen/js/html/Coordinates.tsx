import {Register} from "../../genes/Register"

/**
The `Coordinates` interface represents the position and altitude of the device on Earth, as well as the accuracy with which these properties are calculated.

Documentation [Coordinates](https://developer.mozilla.org/en-US/docs/Web/API/Coordinates) by [Mozilla Contributors](https://developer.mozilla.org/en-US/docs/Web/API/Coordinates$history), licensed under [CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/).

@see <https://developer.mozilla.org/en-US/docs/Web/API/Coordinates>
*/
export type Coordinates = {
	/**
	Returns a `double` representing the accuracy of the `latitude` and `longitude` properties, expressed in meters.
	*/
	accuracy: number,
	/**
	Returns a `double` representing the position's altitude in meters, relative to sea level. This value can be `null` if the implementation cannot provide the data.
	*/
	altitude: number,
	/**
	Returns a `double` representing the accuracy of the `altitude` expressed in meters. This value can be `null`.
	*/
	altitudeAccuracy: number,
	/**
	Returns a `double` representing the direction in which the device is traveling. This value, specified in degrees, indicates how far off from heading true north the device is. `0` degrees represents true north, and the direction is determined clockwise (which means that east is `90` degrees and west is `270` degrees). If `speed` is `0`, `heading` is `NaN`. If the device is unable to provide `heading` information, this value is `null`.
	*/
	heading: number,
	/**
	Returns a `double` representing the position's latitude in decimal degrees.
	*/
	latitude: number,
	/**
	Returns a `double` representing the position's longitude in decimal degrees.
	*/
	longitude: number,
	/**
	Returns a `double` representing the velocity of the device in meters per second. This value can be `null`.
	*/
	speed: number
}
