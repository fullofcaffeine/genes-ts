package todo.server;

import js.node.Fs;
import js.node.Path;
import todo.extern.Express;
import todo.shared.Api;
import todo.shared.Api.ErrorResponse;
import todo.shared.Api.TodoListResponse;
import todo.shared.Api.TodoResponse;

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

    // Both compiler profiles use this source. The environment override keeps
    // generated trees isolated during differential QA while preserving the
    // ordinary default path used by `npm run example:todoapp`.
    final webDist = switch nodeProcess.env.get("TODOAPP_WEB_DIST") {
      case null:
        Path.join(nodeProcess.cwd(), "examples", "todoapp", "web", "dist");
      case configured:
        Path.resolve(configured);
    }

    final store = new Store(dataPath);

    final app = Express.call();
    // Express normally rejects primitive JSON before a route can inspect it.
    // Let the Todo decoder own every valid JSON shape so arrays, numbers, and
    // objects all receive the same stable API error envelope.
    app.use(Express.json({strict: false}));

    app.get("/api/health", (_, res) -> {
      // Express accepts any JSON-compatible object. Haxe 4.3.7's null checker
      // cannot prove an anonymous literal satisfies this host-extern boundary.
      @:nullSafety(Off)
      res.json({ok: true});
    });

    app.get(Api.TODOS, (_, res) -> {
      final body: TodoListResponse = {todos: store.list()};
      res.json(body);
    });

    app.get("/api/todos/:id", (req, res) -> {
      final decodedId = ApiRequestDecoder.todoId(req.params.get("id"));
      final id = decodedId.value;
      if (id == null) {
        sendError(res, 400, decodedId.error);
        return;
      }
      switch store.get(id) {
        case null:
          sendError(res, 404, "not_found");
        case todo:
          // Haxe 4.3.7 loses this switch narrowing when the value enters an
          // anonymous response record. The null case above is exhaustive.
          @:nullSafety(Off)
          final body: TodoResponse = {todo: todo};
          res.json(body);
      }
    });

    app.post(Api.TODOS, (req, res) -> {
      final decodedBody = ApiRequestDecoder.create(req.body);
      final body = decodedBody.value;
      if (body == null) {
        sendError(res, 400, decodedBody.error);
        return;
      }
      final todo = store.create(body.title);
      final out: TodoResponse = {todo: todo};
      res.status(201).json(out);
    });

    app.patch("/api/todos/:id", (req, res) -> {
      final decodedId = ApiRequestDecoder.todoId(req.params.get("id"));
      final id = decodedId.value;
      if (id == null) {
        sendError(res, 400, decodedId.error);
        return;
      }
      final decodedPatch = ApiRequestDecoder.update(req.body);
      final patch = decodedPatch.value;
      if (patch == null) {
        sendError(res, 400, decodedPatch.error);
        return;
      }
      final title = patch.title;
      final completed = patch.completed;
      final todo = if (title != null) {
        if (completed != null)
          store.updateBoth(id, title, completed);
        else
          store.updateTitle(id, title);
      } else if (completed != null) {
        store.updateCompleted(id, completed);
      } else {
        // The decoder rejects empty objects. Keep this branch fail-closed if a
        // future decoder change ever violates that invariant.
        sendError(res, 400, "invalid_patch");
        return;
      }
      switch todo {
        case null:
          sendError(res, 404, "not_found");
        case updated:
          // Same Haxe 4.3.7 anonymous-record narrowing limitation as GET.
          @:nullSafety(Off)
          final out: TodoResponse = {todo: updated};
          res.json(out);
      }
    });

    app.delete("/api/todos/:id", (req, res) -> {
      final decodedId = ApiRequestDecoder.todoId(req.params.get("id"));
      final id = decodedId.value;
      if (id == null) {
        sendError(res, 400, decodedId.error);
        return;
      }
      final ok = store.remove(id);
      if (!ok) {
        sendError(res, 404, "not_found");
        return;
      }
      res.status(204).send("");
    });

    // Serve the built web frontend (React Router SPA).
    if (Fs.existsSync(webDist)) {
      app.use(Express.static_(webDist));
    }

    final indexPath = Path.join(webDist, "index.html");
    final indexHtml = if (Fs.existsSync(indexPath)) Fs.readFileSync(indexPath,
      "utf8") else null;

    app.get("*", (req, res) -> {
      if (StringTools.startsWith(req.path, "/api")) {
        final err: ErrorResponse = {error: "not_found"};
        res.status(404).json(err);
        return;
      }
      if (indexHtml == null) {
        res.status(404)
          .set("Content-Type", "text/plain; charset=utf-8")
          .send("Todoapp frontend not built. Run: npm run example:todoapp");
        return;
      }
      res.set("Content-Type", "text/html; charset=utf-8").send(indexHtml);
    });

    // Express parses JSON before route handlers run. A syntax error therefore
    // cannot reach ApiRequestDecoder, but it is still part of the same public
    // HTTP boundary. Recognize only body-parser's documented parse-failure
    // identity; unrelated middleware errors continue through Express.
    app.useError(ApiRequestDecoder.handleMalformedJson);

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

  static function sendError(res: ExpressResponse, status: Int,
      error: String): Void {
    final body: ErrorResponse = {error: error};
    res.status(status).json(body);
  }
}
