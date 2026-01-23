package todo.web.pages;

import genes.react.JSX.*;
import todo.extern.React.useEffect;
import todo.extern.React.useState;
import todo.extern.ReactRouterDom.Link;
import todo.shared.Todo;
import todo.shared.TodoId;
import todo.web.Client;

@:jsx_inline_markup
class TodoListPage {
  public static function Component(): Dynamic {
    final todosState = useState(([] : Array<Todo>));
    final todos: Array<Todo> = cast todosState[0];
    final setTodos: Array<Todo>->Void = cast todosState[1];

    final titleState = useState("");
    final title: String = cast titleState[0];
    final setTitle: String->Void = cast titleState[1];

    final errorState = useState("");
    final error: String = cast errorState[0];
    final setError: String->Void = cast errorState[1];

    useEffect(() -> {
      Client.listTodos().then(next -> {
        setTodos(next);
        return null;
      }).catchError(err -> {
        setError("Failed to load todos");
        return null;
      });
      return null;
    }, []);

    function replaceTodo(updated: Todo) {
      final next = [for (t in todos) t.id == updated.id ? updated : t];
      setTodos(next);
    }

    function removeTodo(id: TodoId) {
      final next = [for (t in todos) if (t.id != id) t];
      setTodos(next);
    }

    function onAdd() {
      final trimmed = StringTools.trim(title);
      if (trimmed.length == 0)
        return;
      setError("");
      Client.createTodo(trimmed).then(todo -> {
        setTodos(todos.concat([todo]));
        setTitle("");
        return null;
      }).catchError(_ -> {
        setError("Failed to create todo");
        return null;
      });
    }

    function renderTodoTitle(todo: Todo): Dynamic {
      return if (todo.completed)
        <s>{todo.title}</s>
      else
        todo.title;
    }

    function renderTodoItem(todo: Todo): Dynamic {
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
          onChange={_ -> Client.updateTodo(todo.id, {completed: !todo.completed}).then(updated -> { replaceTodo(updated); return null; })}
        />
        <Link to={"/todos/" + todo.id} style={{flex: "1"}}>
          {renderTodoTitle(todo)}
        </Link>
        <button
          onClick={_ -> Client.deleteTodo(todo.id).then(_ -> { removeTodo(todo.id); return null; })}
        >
          Delete
        </button>
      </li>;
    }

    return <div>
      <h2>Todos</h2>
      {error != "" ? <p style={{color: "crimson"}}>{error}</p> : null}
      <div style={{display: "flex", gap: "8px", marginBottom: "12px"}}>
        <input
          value={title}
          placeholder={"New todo"}
          onChange={e -> setTitle(untyped e.target.value)}
          style={{flex: "1", padding: "8px"}}
        />
        <button onClick={_ -> onAdd()} style={{padding: "8px 12px"}}>Add</button>
      </div>
      <ul style={{listStyle: "none", padding: "0", margin: "0"}}>
        {todos.map(renderTodoItem)}
      </ul>
    </div>;
  }
}
