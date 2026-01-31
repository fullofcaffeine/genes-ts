import {Register} from "../../genes/Register"

/**
The `StorageEstimate` dictionary is used by the `StorageManager` to provide estimates of the size of a site's or application's data store and how much of it is in use. The `estimate()` method returns an object that conforms to this dictionary when its `Promise` resolves.

Documentation [StorageEstimate](https://developer.mozilla.org/en-US/docs/Web/API/StorageEstimate) by [Mozilla Contributors](https://developer.mozilla.org/en-US/docs/Web/API/StorageEstimate$history), licensed under [CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/).

@see <https://developer.mozilla.org/en-US/docs/Web/API/StorageEstimate>
*/
export type StorageEstimate = {
	/**
	A numeric value which provides a conservative approximation of the total storage the user's device or computer has available for the site origin or Web app. It's possible that there's more than this amount of space available though you can't rely on that being the case.
	*/
	quota?: number | null,
	/**
	A numeric value approximating the amount of storage space currently being used by the site or Web app, out of the available space as indicated by `quota`.
	*/
	usage?: number | null
}
