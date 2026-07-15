import type {ReactElement} from "./web/classic-src-gen/todo/web/ReactTypes.js";
import {
  TodoListPage,
  type PrettyButtonProps
} from "./web/classic-src-gen/todo/web/pages/TodoListPage.js";
import {Store} from "./server/classic-src-gen/todo/server/Store.js";
import type {Todo} from "./server/classic-src-gen/todo/shared/Todo.js";

const store = new Store("/tmp/genes-todoapp-example.json");
const found: Todo | null = store.get("todo-1");
const element: ReactElement = TodoListPage.Component();
const props: PrettyButtonProps = {
  label: "Add",
  onClick: () => undefined,
  variant: "primary"
};

// @ts-expect-error the emitted Store surface is closed.
store.nonexistentMethod();
// @ts-expect-error raw metadata must retain the literal variant union.
const invalidProps: PrettyButtonProps = {...props, variant: "warning"};

void found;
void element;
void invalidProps;
