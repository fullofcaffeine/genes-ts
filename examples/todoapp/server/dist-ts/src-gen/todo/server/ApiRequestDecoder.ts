import {UnknownNarrow} from "../../genes/ts/UnknownNarrow.js"
import {StringTools} from "../../StringTools.js"
import {Register} from "../../genes/Register.js"
import type {ExpressRequest, ExpressResponse} from "../extern/Express.js"
import type {CreateTodoBody, ErrorResponse} from "../shared/Api.js"

/**
 * Result of checking an untrusted HTTP value against one Todo API shape.
 */
export type ApiDecode<T> = {
	error: string,
	value: T | null
}

/**
 * A non-empty Todo update after the untrusted JSON checks have passed.
 */
export type DecodedTodoUpdate = {
	completed?: boolean | undefined,
	title?: string | undefined
}

/**
 * Converts untrusted Express inputs into precise Todo API values.
 *
 * Keeping these checks outside route handlers makes the trust boundary easy
 * to audit: application code never casts a request body and the generated
 * TypeScript keeps `unknown` until the runtime checks have succeeded.
 */
export class ApiRequestDecoder {

	/**
	 * Preserve the API envelope for JSON syntax errors raised before a route can
	 * inspect `req.body`. Unrelated Express errors remain owned by later error
	 * middleware.
	 */
	static handleMalformedJson(error: unknown, _: ExpressRequest, res: ExpressResponse, next: ((arg0: unknown) => void)): void {
		let details: Readonly<Record<string, unknown>> | null = UnknownNarrow.record(error);
		if (details != null && UnknownNarrow.string(Object.prototype.hasOwnProperty.call(details, "type") ? details["type"] : undefined) == "entity.parse.failed") {
			const body: ErrorResponse = {"error": "invalid_json"};
			res.status(400).json(body);
			return;
		};
		next(error);
	}
	static todoId(raw: string | null): ApiDecode<string> {
		if (raw == null || StringTools.trim(raw).length == 0) {
			return {"value": null, "error": "invalid_id"};
		};
		const this1: string = raw;
		return {"value": this1, "error": ""};
	}
	static create(body: unknown): ApiDecode<CreateTodoBody> {
		let record: Readonly<Record<string, unknown>> | null = UnknownNarrow.record(body);
		if (record == null || !ApiRequestDecoder.hasCreateShape(record)) {
			return {"value": null, "error": "invalid_body"};
		};
		const _g: string | null = UnknownNarrow.string(Object.prototype.hasOwnProperty.call(record, "title") ? record["title"] : undefined);
		if (_g == null) {
			return {"value": null, "error": "invalid_title"};
		} else {
			const title: string = _g;
			if (StringTools.trim(title).length == 0) {
				return {"value": null, "error": "invalid_title"};
			} else {
				const title_1: string = _g;
				const value: CreateTodoBody = {"title": title_1};
				return {"value": value, "error": ""};
			};
		};
	}
	static update(body: unknown): ApiDecode<DecodedTodoUpdate> {
		let record: Readonly<Record<string, unknown>> | null = UnknownNarrow.record(body);
		if (record == null || !ApiRequestDecoder.hasOnlyUpdateFields(record)) {
			return {"value": null, "error": "invalid_patch"};
		};
		const hasTitle: boolean = Object.prototype.hasOwnProperty.call(record, "title");
		const hasCompleted: boolean = Object.prototype.hasOwnProperty.call(record, "completed");
		if (!hasTitle && !hasCompleted) {
			return {"value": null, "error": "invalid_patch"};
		};
		if (hasTitle) {
			const title: string | null = UnknownNarrow.string(Object.prototype.hasOwnProperty.call(record, "title") ? record["title"] : undefined);
			if (title == null || StringTools.trim(title).length == 0) {
				return {"value": null, "error": "invalid_patch"};
			};
			if (hasCompleted) {
				const completed: boolean | null = UnknownNarrow.bool(Object.prototype.hasOwnProperty.call(record, "completed") ? record["completed"] : undefined);
				if (completed == null) {
					return {"value": null, "error": "invalid_patch"};
				};
				const value: DecodedTodoUpdate = {"title": (title ?? undefined), "completed": (completed ?? undefined)};
				return {"value": value, "error": ""};
			};
			const value_1: DecodedTodoUpdate = {"title": (title ?? undefined)};
			return {"value": value_1, "error": ""};
		};
		const completed_1: boolean | null = UnknownNarrow.bool(Object.prototype.hasOwnProperty.call(record, "completed") ? record["completed"] : undefined);
		if (completed_1 == null) {
			return {"value": null, "error": "invalid_patch"};
		};
		const value_2: DecodedTodoUpdate = {"completed": (completed_1 ?? undefined)};
		return {"value": value_2, "error": ""};
	}
	static hasCreateShape(record: Readonly<Record<string, unknown>>): boolean {
		if (Object.prototype.hasOwnProperty.call(record, "title")) {
			return (Object.keys(record)).length == 1;
		} else {
			return false;
		};
	}
	static hasOnlyUpdateFields(record: Readonly<Record<string, unknown>>): boolean {
		let _g_1: number = 0;
		const _g1: string[] = Object.keys(record);
		while (_g_1 < _g1.length) {
			const key: string = _g1[_g_1]!;
			++_g_1;
			if (key != "title" && key != "completed") {
				return false;
			};
		};
		return true;
	}
	static get __name__(): string {
		return "todo.server.ApiRequestDecoder"
	}
	get __class__(): Function {
		return ApiRequestDecoder
	}
}
Register.setHxClass("todo.server.ApiRequestDecoder", ApiRequestDecoder);
