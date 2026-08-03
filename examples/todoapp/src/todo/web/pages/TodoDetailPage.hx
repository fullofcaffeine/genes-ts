package todo.web.pages;

import genes.react.JSX.*;
import genes.react.React.deps;
import genes.react.React.useEffect;
import genes.react.React.useState;
import todo.extern.ReactRouter.Link;
import todo.extern.ReactRouter.useNavigate;
import todo.shared.Api.UpdateTodoTitleBody;
import todo.shared.Todo;
import todo.shared.TodoId;
import todo.web.Client;
import todo.web.Router;
import todo.web.ReactTypes.ChangeEvent;
import todo.web.ReactTypes.ReactElement;

@:jsx_inline_markup
class TodoDetailPage {
  @:genes.reactComponent
  public static function Component(): ReactElement {
    final idStr = Router.useParam("id");
    final id: Null<TodoId> = idStr;

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
    }, deps(idStr));

    function onSave() {
      if (id == null)
        return;
      final trimmed = StringTools.trim(title);
      if (trimmed.length == 0) {
        errorState.set("Title is required");
        return;
      }
      final patch: UpdateTodoTitleBody = {title: trimmed};
      Client.updateTodo(id, patch).then(updated -> {
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

    final todoValue: Todo = todo;

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
        <button onClick={() -> onSave()} style={{padding: "8px 12px"}}>Save</button>
      </div>
    </div>;
  }
}
