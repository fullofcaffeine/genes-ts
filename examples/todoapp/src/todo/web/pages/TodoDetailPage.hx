package todo.web.pages;

import genes.react.JSX.*;
import todo.extern.React.useEffect;
import todo.extern.React.useState;
import todo.extern.ReactRouterDom.Link;
import todo.extern.ReactRouterDom.useNavigate;
import todo.extern.ReactRouterDom.useParams;
import todo.shared.Todo;
import todo.shared.TodoId;
import todo.web.Client;

@:jsx_inline_markup
class TodoDetailPage {
  public static function Component(): Dynamic {
    final params: Dynamic = useParams();
    final idStr: Null<String> = cast params.id;
    final id: Null<TodoId> = idStr == null ? null : cast idStr;

    final todoState = useState(null);
    final todo: Todo = cast todoState[0];
    final setTodo: Todo->Void = cast todoState[1];

    final titleState = useState("");
    final title: String = cast titleState[0];
    final setTitle: String->Void = cast titleState[1];

    final errorState = useState("");
    final error: String = cast errorState[0];
    final setError: String->Void = cast errorState[1];

    final navigateDyn: Dynamic = useNavigate();
    final navigate: String->Void = cast navigateDyn;

    useEffect(() -> {
      if (id == null) {
        setError("Missing id");
        return;
      }
      Client.getTodo(id).then(t -> {
        setTodo(t);
        setTitle(t.title);
      }).catchError(_ -> {
        setError("Todo not found");
      });
    }, [idStr]);

    function onSave() {
      if (id == null)
        return;
      final trimmed = StringTools.trim(title);
      if (trimmed.length == 0)
        return;
      Client.updateTodo(id, {title: trimmed}).then(updated -> {
        setTodo(updated);
        navigate("/");
        return null;
      }).catchError(_ -> {
        setError("Failed to save");
        return null;
      });
    }

    if (error != "")
      return <div>
        <p style={{color: "crimson"}}>{error}</p>
        <Link to={"/"}>Back</Link>
      </div>;

    if (todo == null)
      return <p>Loading...</p>;

    return <div>
      <p><Link to={"/"}>← Back</Link></p>
      <h2>Todo</h2>
      <p><b>ID:</b> {todo.id}</p>
      <p><b>Created:</b> {todo.createdAt}</p>
      <p><b>Updated:</b> {todo.updatedAt}</p>
      <label style={{display: "block", marginTop: "12px"}}>
        Title
        <input
          value={title}
          onChange={e -> setTitle(untyped e.target.value)}
          style={{display: "block", width: "100%", padding: "8px", marginTop: "6px"}}
        />
      </label>
      <div style={{marginTop: "12px"}}>
        <button onClick={_ -> onSave()} style={{padding: "8px 12px"}}>Save</button>
      </div>
    </div>;
  }
}
