import {Register} from "../../genes/Register.js"

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
* - `body` is still a dynamic bag because JSON payloads vary by route; each
*   handler casts into the specific API type it expects.
*/
export type ExpressRequest = import('express').Request

/**
* Response object (subset).
*
* Typed fluent interface so code stays ergonomic and TS output stays typed.
*/
export type ExpressResponse = import('express').Response
