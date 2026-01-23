package todo.extern;

// Minimal React Router externs used by the todoapp example.
// React Router ships its own TS types; these externs exist to generate imports.

@:jsRequire("react-router-dom", "BrowserRouter")
extern class BrowserRouter {}

@:jsRequire("react-router-dom", "Routes")
extern class Routes {}

@:jsRequire("react-router-dom", "Route")
extern class Route {}

@:jsRequire("react-router-dom", "Link")
extern class Link {}

@:jsRequire("react-router-dom", "useNavigate")
extern function useNavigate(): Dynamic;

@:jsRequire("react-router-dom", "useParams")
extern function useParams(): Dynamic;

