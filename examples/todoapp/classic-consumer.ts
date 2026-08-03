import type {ReactElement} from "./web/classic-src-gen/todo/web/ReactTypes.js";
import {
  TodoListPage,
  type PrettyButtonProps
} from "./web/classic-src-gen/todo/web/pages/TodoListPage.js";
import {Store} from "./server/classic-src-gen/todo/server/Store.js";
import type {Todo} from "./server/classic-src-gen/todo/shared/Todo.js";
import type {UpdateTodoBody} from "./server/classic-src-gen/todo/shared/Api.js";

const store = new Store("/tmp/genes-todoapp-example.json");
const found: Todo | null = store.get("todo-1");
const element: ReactElement = TodoListPage.Component();
const props: PrettyButtonProps = {
  label: "Add",
  onClick: () => undefined,
  variant: "primary"
};
const titlePatch: UpdateTodoBody = {title: "Renamed"};
const completedPatch: UpdateTodoBody = {completed: true};
const completePatch: UpdateTodoBody = {title: "Renamed", completed: true};
const titleUpdate: Todo | null = store.updateTitle("todo-1", "Renamed");
const completedUpdate: Todo | null = store.updateCompleted("todo-1", true);
const completeUpdate: Todo | null = store.updateBoth("todo-1", "Renamed", true);

// @ts-expect-error the emitted Store surface is closed.
store.nonexistentMethod();
// @ts-expect-error raw metadata must retain the literal variant union.
const invalidProps: PrettyButtonProps = {...props, variant: "warning"};
// @ts-expect-error the server rejects explicit JSON null for a boolean field.
const nullPatch: UpdateTodoBody = {completed: null};
// @ts-expect-error a PATCH must change at least one Todo field.
const emptyPatch: UpdateTodoBody = {};
// @ts-expect-error Store mutation accepts a checked boolean, never null.
store.updateCompleted("todo-1", null);
// @ts-expect-error callers cannot bypass the decoder with a loose patch object.
store.update("todo-1", {completed: null});

void found;
void element;
void invalidProps;
void titlePatch;
void completedPatch;
void completePatch;
void nullPatch;
void emptyPatch;
void titleUpdate;
void completedUpdate;
void completeUpdate;
