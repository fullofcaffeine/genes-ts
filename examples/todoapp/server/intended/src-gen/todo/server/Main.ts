import type {Todo} from "../shared/Todo.js"
import type {TodoListResponse, ErrorResponse, TodoResponse, CreateTodoBody, UpdateTodoBody} from "../shared/Api.js"
import {Store} from "./Store.js"
import type {ExpressApp, ExpressRequest, ExpressResponse} from "../extern/Express.js"
import * as Path from "path"
import {Register} from "../../genes/Register.js"
import * as Fs from "fs"
import Express from "express"
import type {Console} from "console"
import {StringTools} from "../../StringTools.js"
import {Std} from "../../Std.js"

export class Main {
	static main(): void {
		let nodeProcess: NodeJS.Process = process;
		let nodeConsole: Console = console;
		let port: number = Main.parsePort((nodeProcess.env["PORT"] ?? null), 8787);
		let dataPath: string | null;
		let _g: string | null = (nodeProcess.env["TODOAPP_DATA_PATH"] ?? null);
		if (_g == null) {
			dataPath = Path.join(nodeProcess.cwd(), "examples", "todoapp", "server", "data.json");
		} else {
			let v: string | null = _g;
			dataPath = v;
		};
		let webDist: string = Path.join(nodeProcess.cwd(), "examples", "todoapp", "web", "dist");
		let store: Store = new Store(dataPath);
		let app: ExpressApp = Express();
		app.use(Express.json());
		app.get("/api/health", function (_: ExpressRequest, res: ExpressResponse) {
			res.json({"ok": true});
		});
		app.get("/api/todos", function (_: ExpressRequest, res: ExpressResponse) {
			let body: TodoListResponse = {"todos": store.list()};
			res.json(body);
		});
		app.get("/api/todos/:id", function (req: ExpressRequest, res: ExpressResponse) {
			let id: string = (req.params["id"] ?? null);
			let todo: Todo | null = store.get(id);
			if (todo == null) {
				let body: ErrorResponse = {"error": "not_found"};
				res.status(404).json(body);
				return;
			};
			let body: TodoResponse = {"todo": todo};
			res.json(body);
		});
		app.post("/api/todos", function (req: ExpressRequest, res: ExpressResponse) {
			let body: CreateTodoBody = req.body;
			if (body == null || body.title == null || StringTools.trim(body.title).length == 0) {
				let err: ErrorResponse = {"error": "invalid_title"};
				res.status(400).json(err);
				return;
			};
			let todo: Todo = store.create(body.title);
			let out: TodoResponse = {"todo": todo};
			res.status(201).json(out);
		});
		app.patch("/api/todos/:id", function (req: ExpressRequest, res: ExpressResponse) {
			let id: string = (req.params["id"] ?? null);
			let patch: UpdateTodoBody = req.body;
			let todo: Todo | null = store.update(id, (patch == null) ? {} : patch);
			if (todo == null) {
				let err: ErrorResponse = {"error": "not_found"};
				res.status(404).json(err);
				return;
			};
			let out: TodoResponse = {"todo": todo};
			res.json(out);
		});
		app["delete"]("/api/todos/:id", function (req: ExpressRequest, res: ExpressResponse) {
			let id: string = (req.params["id"] ?? null);
			let ok: boolean = store.remove(id);
			if (!ok) {
				let err: ErrorResponse = {"error": "not_found"};
				res.status(404).json(err);
				return;
			};
			res.status(204).send("");
		});
		if (Fs.existsSync(webDist)) {
			app.use(Express["static"](webDist));
		};
		let indexPath: string = Path.join(webDist, "index.html");
		let indexHtml: string | null | null = (Fs.existsSync(indexPath)) ? Fs.readFileSync(indexPath, "utf8") : null;
		app.get("*", function (req: ExpressRequest, res: ExpressResponse) {
			if (req.path.startsWith("/api")) {
				let err: ErrorResponse = {"error": "not_found"};
				res.status(404).json(err);
				return;
			};
			if (indexHtml == null) {
				res.status(404).set("Content-Type", "text/plain; charset=utf-8").send("Todoapp frontend not built. Run: npm run build:example:todoapp");
				return;
			};
			res.set("Content-Type", "text/html; charset=utf-8").send(Register.unsafeCast<string>(indexHtml));
		});
		app.listen(port, function () {
			nodeConsole.log("todoapp listening on http://localhost:" + port);
		});
	}
	static parsePort(v: string | null, fallback: number): number {
		if (v == null) {
			return fallback;
		};
		let n: number | null = Std.parseInt(Register.unsafeCast<string>(v));
		if (n == null) {
			return fallback;
		} else {
			return Register.unsafeCast<number>(n);
		};
	}
	static get __name__(): string {
		return "todo.server.Main"
	}
	get __class__(): Function {
		return Main
	}
}
Register.setHxClass("todo.server.Main", Main);
