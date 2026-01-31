export type Todo = {
  id: number;
  title: string;
  done?: boolean;
};

export function makeTodo(id: number, title: string): Todo {
  return { id, title };
}

