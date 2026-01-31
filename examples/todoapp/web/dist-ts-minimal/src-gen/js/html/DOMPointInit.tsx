import {Register} from "../../genes/Register"

/**
The `DOMPointInit` dictionary is used to provide the values of the coordinates and perspective when creating and JSONifying a `DOMPoint` or `DOMPointReadOnly` object.

Documentation [DOMPointInit](https://developer.mozilla.org/en-US/docs/Web/API/DOMPointInit) by [Mozilla Contributors](https://developer.mozilla.org/en-US/docs/Web/API/DOMPointInit$history), licensed under [CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/).

@see <https://developer.mozilla.org/en-US/docs/Web/API/DOMPointInit>
*/
export type DOMPointInit = {
	/**
	The point's w perspective value given as an unrestricted floating-point number. The default is 1.
	*/
	w?: number | null,
	/**
	An unrestricted floating-point value indicating the x-coordinate of the point in space. This is generally the horizontal coordinate, with positive values being to the right and negative values to the left. The default value is 0.
	*/
	x?: number | null,
	/**
	An unrestricted floating-point number providing the point's y-coordinate. This is the vertical coordinate, and barring any transforms applied to the coordinate system, positive values are downward and negative values upward toward the top of the screen. The default is 0.
	*/
	y?: number | null,
	/**
	An unrestricted floating-point value which gives the point's z-coordinate, which is (assuming no transformations that alter the situation) the depth coordinate; positive values are closer to the user and negative values retreat back into the screen. The default value is 0.
	*/
	z?: number | null
}
