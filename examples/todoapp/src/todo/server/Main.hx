package todo.server;

import js.node.Fs;
import js.node.Path;
import todo.extern.Express;
import todo.shared.Api;
import todo.shared.Api.CreateTodoBody;
import todo.shared.Api.ErrorResponse;
import todo.shared.Api.TodoListResponse;
import todo.shared.Api.TodoResponse;
import todo.shared.Api.UpdateTodoBody;
import todo.shared.TodoId;

class Main {
  static function main() {
    // Typed access to Node globals without triggering `__js__` deprecation warnings.
    // See `todo.server.NodeGlobals` for the rationale and details.
    final nodeProcess = NodeGlobals.process();
    final nodeConsole = NodeGlobals.console();

    final port = parsePort(nodeProcess.env.get("PORT"), 8787);
    final dataPath = switch nodeProcess.env.get("TODOAPP_DATA_PATH") {
      case null:
        Path.join(nodeProcess.cwd(), "examples", "todoapp", "server",
          "data.json");
      case v:
        v;
    }

    final webDist = Path.join(nodeProcess.cwd(), "examples", "todoapp", "web",
      "dist");

    final store = new Store(dataPath);

    final app = Express.call();
    app.use(Express.json());

    app.get("/api/health", (_, res) -> {
      res.json({ok: true});
    });

    app.get(Api.TODOS, (_, res) -> {
      final body: TodoListResponse = {todos: store.list()};
      res.json(body);
    });

    app.get("/api/todos/:id", (req, res) -> {
      final id: TodoId = cast req.params.get("id");
      final todo = store.get(id);
      if (todo == null) {
        final body: ErrorResponse = {error: "not_found"};
        res.status(404).json(body);
        return;
      }
      final body: TodoResponse = {todo: todo};
      res.json(body);
    });

    app.post(Api.TODOS, (req, res) -> {
      final body: CreateTodoBody = cast req.body;
      if (body == null || body.title == null
        || StringTools.trim(body.title).length == 0) {
        final err: ErrorResponse = {error: "invalid_title"};
        res.status(400).json(err);
        return;
      }
      final todo = store.create(body.title);
      final out: TodoResponse = {todo: todo};
      res.status(201).json(out);
    });

    app.patch("/api/todos/:id", (req, res) -> {
      final id: TodoId = cast req.params.get("id");
      final patch: UpdateTodoBody = cast req.body;
      final todo = store.update(id, patch == null ? {} : patch);
      if (todo == null) {
        final err: ErrorResponse = {error: "not_found"};
        res.status(404).json(err);
        return;
      }
      final out: TodoResponse = {todo: todo};
      res.json(out);
    });

    app.delete("/api/todos/:id", (req, res) -> {
      final id: TodoId = cast req.params.get("id");
      final ok = store.remove(id);
      if (!ok) {
        final err: ErrorResponse = {error: "not_found"};
        res.status(404).json(err);
        return;
      }
      res.status(204).send("");
    });

    // Serve the built web frontend (React Router SPA).
    if (Fs.existsSync(webDist)) {
      app.use(Express.static_(webDist));
    }

    final indexPath = Path.join(webDist, "index.html");
    final indexHtml = if (Fs.existsSync(indexPath))
      Fs.readFileSync(indexPath, "utf8")
    else
      null;

    app.get("*", (req, res) -> {
      if (StringTools.startsWith(req.path, "/api")) {
        final err: ErrorResponse = {error: "not_found"};
        res.status(404).json(err);
        return;
      }
      if (indexHtml == null) {
        res.status(404).set("Content-Type", "text/plain; charset=utf-8").send(
          "Todoapp frontend not built. Run: npm run example:todoapp");
        return;
      }
      res.set("Content-Type", "text/html; charset=utf-8").send(indexHtml);
    });

    app.listen(port, () -> {
      nodeConsole.log('todoapp listening on http://localhost:$port');
    });
  }

  static function parsePort(v: Null<String>, fallback: Int): Int {
    if (v == null)
      return fallback;
    final n = Std.parseInt(v);
    return n == null ? fallback : n;
  }
}
