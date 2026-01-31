import {Register} from "../../genes/Register"

/**
The `EventListener` interface represents an object that can handle an event dispatched by an `EventTarget` object.

Documentation [EventListener](https://developer.mozilla.org/en-US/docs/Web/API/EventListener) by [Mozilla Contributors](https://developer.mozilla.org/en-US/docs/Web/API/EventListener$history), licensed under [CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/).

@see <https://developer.mozilla.org/en-US/docs/Web/API/EventListener>
*/
export type EventListener = {
	/**
	A function that is called whenever an event of the specified type occurs.
	*/
	handleEvent: (event: Event) => void
}
