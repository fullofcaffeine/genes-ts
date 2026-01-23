package todo.web;

import genes.react.JSX.*;
import todo.extern.ReactRouterDom.BrowserRouter;
import todo.extern.ReactRouterDom.Link;
import todo.extern.ReactRouterDom.Route;
import todo.extern.ReactRouterDom.Routes;
import todo.web.pages.TodoDetailPage;
import todo.web.pages.TodoListPage;

@:jsx_inline_markup
class App {
  public static function Component(): Dynamic {
    final TodoListComponent: Dynamic = TodoListPage.Component;
    final TodoDetailComponent: Dynamic = TodoDetailPage.Component;

    return <BrowserRouter>
      <div style={{
        maxWidth: "720px",
        margin: "0 auto",
        padding: "16px",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
      }}>
        <header style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
          <h1 style={{margin: "0"}}>Todoapp</h1>
          <nav>
            <Link to={"/"} style={{textDecoration: "none"}}>Home</Link>
          </nav>
        </header>
        <hr />
        <Routes>
          <Route path={"/"} element={<TodoListComponent />} />
          <Route path={"/todos/:id"} element={<TodoDetailComponent />} />
        </Routes>
      </div>
    </BrowserRouter>;
  }
}
