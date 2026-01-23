import {Register} from "../../genes/Register.js"

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
export type ObjectPropertyDescriptor = {
	/**
	`true` if and only if the type of this property descriptor may be
	changed and if the property may be deleted from the corresponding object.

	Defaults to `false`.
	*/
	configurable?: any,
	/**
	`true` if and only if this property shows up during enumeration of the
	properties on the corresponding object.

	Defaults to `false`.
	*/
	enumerable?: any,
	/**
	A function which serves as a getter for the property, or `undefined` if
	there is no getter. When the property is accessed, this function is
	called without arguments and with `this` set to the object through which
	the property is accessed (this may not be the object on which the
	property is defined due to inheritance).
	The return value will be used as the value of the property.
	*/
	get?: any,
	/**
	A function which serves as a setter for the property, or undefined if
	there is no setter. When the property is assigned to, this function
	is called with one argument (the value being assigned to the property)
	and with `this` set to the object through which the property is assigned.
	*/
	set?: any,
	/**
	The value associated with the property.
	Can be any valid JavaScript value (number, object, function, etc).
	*/
	value?: any,
	/**
	`true` if and only if the value associated with the property may be
	changed with an assignment operator.

	Defaults to `false`.
	*/
	writable?: any
}

