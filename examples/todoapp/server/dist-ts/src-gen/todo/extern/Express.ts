import {Register} from "../../genes/Register.js"

/**
 * Options used by the Todoapp's JSON parser boundary.
 */
export type ExpressJsonOptions = {
	strict: boolean
}

export type ExpressHandler = ((req: ExpressRequest, res: ExpressResponse) => void)

/**
 * Express application interface.
 *
 * `@:ts.type(...)` is critical here:
 * - It makes the generated TS refer to the real `express.Application` type.
 * - This keeps the example idiomatic for TS consumers and avoids `any`.
 */
export type ExpressApp = import('express').Application

/**
 * Request object (subset).
 *
 * Notes:
 * - We keep `params` as a `DynamicAccess<String>` because Express exposes it as a
 *   string-keyed bag.
 * - `body` stays `Unknown` until the route's decoder has checked its runtime
 *   shape. This prevents an Express `any` default from leaking into ordinary
 *   Haxe application code or generated TypeScript.
 */
export type ExpressRequest = import('express').Request<Record<string, string>, unknown, unknown>

/**
 * Response object (subset).
 *
 * Typed fluent interface so code stays ergonomic and TS output stays typed.
 */
export type ExpressResponse = import('express').Response
