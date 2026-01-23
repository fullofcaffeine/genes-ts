package todo.web.pages;

import genes.react.JSX.*;
import todo.extern.React.useEffect;
import todo.extern.React.useState;
import todo.extern.ReactRouterDom.Link;
import todo.extern.ReactRouterDom.useNavigate;
import todo.shared.Todo;
import todo.shared.TodoId;
import todo.web.Client;
import todo.web.Router;
import todo.web.ReactTypes.ChangeEvent;
import todo.web.ReactTypes.ReactElement;

@:jsx_inline_markup
class TodoDetailPage {
  public static function Component(): ReactElement {
    final idStr = Router.param("id");
    final id: Null<TodoId> = idStr == null ? null : cast idStr;

    final todoState = useState((null : Null<Todo>));
    final todo = todoState.value;

    final titleState = useState("");
    final title = titleState.value;

    final errorState = useState("");
    final error = errorState.value;

    final navigate = useNavigate();

    useEffect(() -> {
      if (id == null) {
        errorState.set("Missing id");
        return;
      }
      Client.getTodo(id).then(t -> {
        todoState.set(t);
        titleState.set(t.title);
      }).catchError(_ -> {
        errorState.set("Todo not found");
      });
    }, [idStr]);

    function onSave() {
      if (id == null)
        return;
      final trimmed = StringTools.trim(title);
      if (trimmed.length == 0)
        return;
      Client.updateTodo(id, {title: trimmed}).then(updated -> {
        todoState.set(updated);
        navigate("/");
      }).catchError(_ -> {
        errorState.set("Failed to save");
      });
    }

    if (error != "")
      return <div>
        <p style={{color: "crimson"}}>{error}</p>
        <Link to={"/"}>Back</Link>
      </div>;

    if (todo == null)
      return <p>Loading...</p>;

    final todoValue: Todo = cast todo;

    return <div>
      <p><Link to={"/"}>← Back</Link></p>
      <h2>Todo</h2>
      <p><b>ID:</b> {todoValue.id}</p>
      <p><b>Created:</b> {todoValue.createdAt}</p>
      <p><b>Updated:</b> {todoValue.updatedAt}</p>
      <label style={{display: "block", marginTop: "12px"}}>
        Title
        <input
          value={title}
          onChange={(e: ChangeEvent) -> titleState.set(e.target.value)}
          style={{display: "block", width: "100%", padding: "8px", marginTop: "6px"}}
        />
      </label>
      <div style={{marginTop: "12px"}}>
        <button onClick={_ -> onSave()} style={{padding: "8px 12px"}}>Save</button>
      </div>
    </div>;
  }
}
