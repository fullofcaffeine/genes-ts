import {Register} from "../../genes/Register"

/**
Type for
@see <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object>
*/
export type ObjectPrototype = {
	/**
	Returns a boolean indicating whether an object contains the specified
	property as a direct property of that object and not inherited through
	the prototype chain.
	*/
	hasOwnProperty: Function,
	/**
	Returns a boolean indicating whether the object this method is called
	upon is in the prototype chain of the specified object.
	*/
	isPrototypeOf: Function,
	/**
	Returns a boolean indicating if the internal enumerable attribute is set.
	*/
	propertyIsEnumerable: Function,
	/**
	Calls `toString()`.
	*/
	toLocaleString: Function,
	/**
	Returns a string representation of the object.
	*/
	toString: Function,
	/**
	Returns the primitive value of the specified object.
	*/
	valueOf: Function
}

/**
@see <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty>
*/
export type ObjectPropertyDescriptor = PropertyDescriptor
