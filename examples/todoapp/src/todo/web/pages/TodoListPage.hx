package todo.web.pages;

import genes.react.JSX.*;
import genes.ts.Imports;
import todo.extern.React.useEffect;
import todo.extern.React.useState;
import todo.extern.ReactRouterDom.Link;
import todo.shared.Todo;
import todo.shared.TodoId;
import todo.shared.TodoText;
import todo.web.Client;
import todo.web.ReactTypes.ChangeEvent;
import todo.web.ReactTypes.ReactChild;
import todo.web.ReactTypes.ReactComponent1;
import todo.web.ReactTypes.ReactElement;

@:jsx_inline_markup
class TodoListPage {
  /**
   * TS-authored component imported from Haxe.
   *
   * This is the “Haxe imports TS/TSX” direction of the interop story.
   */
  static final PrettyButton: ReactComponent1<PrettyButtonProps> =
    Imports.defaultImport("../../../../src-ts/components/PrettyButton");

  /**
   * TS-authored function that imports and calls back into a Haxe-emitted value.
   *
   * This is the “TS imports Haxe output” direction of the interop story:
   * `examples/todoapp/web/src-ts/interop/haxeInterop.ts` imports `TodoText` from
   * generated output and then re-exports a stable banner function.
   */
  static final interopBanner: Void->String =
    Imports.namedImport("../../../../src-ts/interop/haxeInterop", "interopBanner");

  public static function Component(): ReactElement {
    // Keep the Haxe-emitted symbol in the JS/TS output even though it's referenced
    // “indirectly” from TS-only code (Haxe DCE can't see TS imports).
    final _keepTodoText = TodoText.interopBanner();

    final todosState = useState(([] : Array<Todo>));
    final todos = todosState.value;

    final titleState = useState("");
    final title = titleState.value;

    final errorState = useState("");
    final error = errorState.value;

    useEffect(() -> {
      Client.listTodos().then(next -> {
        todosState.set(next);
      }).catchError(_ -> {
        errorState.set("Failed to load todos");
      });
    }, []);

    function replaceTodo(updated: Todo) {
      final next = [for (t in todos) t.id == updated.id ? updated : t];
      todosState.set(next);
    }

    function removeTodo(id: TodoId) {
      final next = [for (t in todos) if (t.id != id) t];
      todosState.set(next);
    }

    function onAdd() {
      final trimmed = StringTools.trim(title);
      if (trimmed.length == 0) {
        errorState.set("Title is required");
        return;
      }
      errorState.set("");
      Client.createTodo(trimmed).then(todo -> {
        todosState.set(todos.concat([todo]));
        titleState.set("");
      }).catchError(_ -> {
        errorState.set("Failed to create todo");
      });
    }

    final errorView: ReactChild = error != "" ? <p style={{color: "crimson"}}>{error}</p> : null;

    function renderTodoTitle(todo: Todo): ReactChild {
      return if (todo.completed)
        <s>{todo.title}</s>
      else
        todo.title;
    }

    function renderTodoItem(todo: Todo): ReactElement {
      return <li key={todo.id} style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 0",
        borderBottom: "1px solid #eee"
      }}>
        <input
          type={"checkbox"}
          checked={todo.completed}
          onChange={() -> Client.updateTodo(todo.id, {completed: !todo.completed}).then(updated -> { replaceTodo(updated); return null; })}
        />
        <Link to={"/todos/" + todo.id} style={{flex: "1"}}>
          {renderTodoTitle(todo)}
        </Link>
        <button
          onClick={() -> Client.deleteTodo(todo.id).then(_ -> { removeTodo(todo.id); return null; })}
        >
          Delete
        </button>
      </li>;
    }

    return <div>
      <h2>Todos</h2>
      {errorView}
      <div style={{display: "flex", gap: "8px", marginBottom: "12px"}}>
        <input
          value={title}
          placeholder={"New todo"}
          onChange={(e: ChangeEvent) -> titleState.set(e.target.value)}
          style={{flex: "1", padding: "8px"}}
        />
        <PrettyButton label={"Add"} onClick={() -> onAdd()} variant={PrettyButtonVariant.Primary} />
      </div>
      <ul style={{listStyle: "none", padding: "0", margin: "0"}}>
        {todos.map(renderTodoItem)}
      </ul>
      <p style={{marginTop: "16px", color: "#666", fontSize: "12px"}}>
        {interopBanner()}
      </p>
    </div>;
  }
}

typedef PrettyButtonProps = {
  final label: String;
  final onClick: Void->Void;
  final ?variant: PrettyButtonVariant;
}

/**
 * Narrow string union used by the TS-authored `PrettyButton` component.
 *
 * Why:
 * - In TypeScript this is a literal string union (`'primary' | 'danger'`).
 * - We want the emitted TS to preserve that exact union so TS consumers get the
 *   same per-prop UX as hand-written TSX.
 *
 * What:
 * - A Haxe `enum abstract` over `String` representing the allowed variants.
 *
 * How:
 * - `@:ts.type("'primary' | 'danger'")` pins the emitted TS type to the literal
 *   union instead of expanding to `string`.
 */
@:ts.type("'primary' | 'danger'")
enum abstract PrettyButtonVariant(String) to String {
  var Primary = "primary";
  var Danger = "danger";
}
