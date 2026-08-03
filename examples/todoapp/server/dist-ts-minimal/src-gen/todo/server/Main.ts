import * as Path from "path"
import {Store} from "./Store.js"
import Express from "express"
import {ApiRequestDecoder} from "./ApiRequestDecoder.js"
import * as Fs from "fs"
import {Std} from "../../Std.js"
import {Register} from "../../genes/Register.js"
import type {ExpressResponse, ExpressApp, ExpressRequest} from "../extern/Express.js"
import type {Console} from "console"
import type {TodoListResponse, TodoResponse, CreateTodoBody, UpdateTodoBody, ErrorResponse} from "../shared/Api.js"
import type {ApiDecode} from "./ApiRequestDecoder.js"
import type {Todo} from "../shared/Todo.js"

export class Main {
	static main(): void {
		const nodeProcess: NodeJS.Process = process;
		const nodeConsole: Console = console;
		const port: number = Main.parsePort((nodeProcess.env["PORT"] ?? null), 8787);
		let dataPath: string | null;
		const _g: string | null = (nodeProcess.env["TODOAPP_DATA_PATH"] ?? null);
		if (_g == null) {
			dataPath = Path.join(nodeProcess.cwd(), "examples", "todoapp", "server", "data.json");
		} else {
			const v: string = _g;
			dataPath = v;
		};
		let webDist: string;
		const _g1: string | null = (nodeProcess.env["TODOAPP_WEB_DIST"] ?? null);
		if (_g1 == null) {
			webDist = Path.join(nodeProcess.cwd(), "examples", "todoapp", "web", "dist");
		} else {
			const configured: string = _g1;
			webDist = Path.resolve(configured);
		};
		const store: Store = new Store(dataPath);
		const app: ExpressApp = Express();
		app.use(Express.json());
		app.get("/api/health", function (_: ExpressRequest, res: ExpressResponse) {
			res.json({"ok": true});
		});
		app.get("/api/todos", function (_: ExpressRequest, res: ExpressResponse) {
			const body: TodoListResponse = {"todos": store.list()};
			res.json(body);
		});
		app.get("/api/todos/:id", function (req: ExpressRequest, res: ExpressResponse) {
			const decodedId: ApiDecode<string> = ApiRequestDecoder.todoId((req.params["id"] ?? null));
			const id: string | null = decodedId.value;
			if (id == null) {
				Main.sendError(res, 400, decodedId.error);
				return;
			};
			const todo: Todo | null = store.get(id);
			if (todo == null) {
				Main.sendError(res, 404, "not_found");
				return;
			};
			const body: TodoResponse = {"todo": todo};
			res.json(body);
		});
		app.post("/api/todos", function (req: ExpressRequest, res: ExpressResponse) {
			const decodedBody: ApiDecode<CreateTodoBody> = ApiRequestDecoder.create(req.body);
			const body: CreateTodoBody | null = decodedBody.value;
			if (body == null) {
				Main.sendError(res, 400, decodedBody.error);
				return;
			};
			const todo: Todo = store.create(body.title);
			const out: TodoResponse = {"todo": todo};
			res.status(201).json(out);
		});
		app.patch("/api/todos/:id", function (req: ExpressRequest, res: ExpressResponse) {
			const decodedId: ApiDecode<string> = ApiRequestDecoder.todoId((req.params["id"] ?? null));
			const id: string | null = decodedId.value;
			if (id == null) {
				Main.sendError(res, 400, decodedId.error);
				return;
			};
			const decodedPatch: ApiDecode<UpdateTodoBody> = ApiRequestDecoder.update(req.body);
			const patch: UpdateTodoBody | null = decodedPatch.value;
			if (patch == null) {
				Main.sendError(res, 400, decodedPatch.error);
				return;
			};
			const todo: Todo | null = store.update(id, patch);
			if (todo == null) {
				Main.sendError(res, 404, "not_found");
				return;
			};
			const out: TodoResponse = {"todo": todo};
			res.json(out);
		});
		app["delete"]("/api/todos/:id", function (req: ExpressRequest, res: ExpressResponse) {
			const decodedId: ApiDecode<string> = ApiRequestDecoder.todoId((req.params["id"] ?? null));
			const id: string | null = decodedId.value;
			if (id == null) {
				Main.sendError(res, 400, decodedId.error);
				return;
			};
			const ok: boolean = store.remove(id);
			if (!ok) {
				Main.sendError(res, 404, "not_found");
				return;
			};
			res.status(204).send("");
		});
		if (Fs.existsSync(webDist)) {
			app.use(Express["static"](webDist));
		};
		const indexPath: string = Path.join(webDist, "index.html");
		const indexHtml: string | null | null = (Fs.existsSync(indexPath)) ? Fs.readFileSync(indexPath, "utf8") : null;
		app.get("*", function (req: ExpressRequest, res: ExpressResponse) {
			if (req.path.startsWith("/api")) {
				const err: ErrorResponse = {"error": "not_found"};
				res.status(404).json(err);
				return;
			};
			if (indexHtml == null) {
				res.status(404).set("Content-Type", "text/plain; charset=utf-8").send("Todoapp frontend not built. Run: npm run example:todoapp");
				return;
			};
			res.set("Content-Type", "text/html; charset=utf-8").send(indexHtml);
		});
		app.listen(port, function () {
			nodeConsole.log("todoapp listening on http://localhost:" + port);
		});
	}
	static parsePort(v: string | null, fallback: number): number {
		if (v == null) {
			return fallback;
		};
		const n: number | null = Std.parseInt(v);
		if (n == null) {
			return fallback;
		} else {
			return n;
		};
	}
	static sendError(res: ExpressResponse, status: number, error: string): void {
		const body: ErrorResponse = {"error": error};
		res.status(status).json(body);
	}
	static get __name__(): string {
		return "todo.server.Main"
	}
	get __class__(): Function {
		return Main
	}
}
