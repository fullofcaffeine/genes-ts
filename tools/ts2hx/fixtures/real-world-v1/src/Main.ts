import { seedTodos, completeFirst } from "./services/todoService.js";
import { isDone } from "./domain/Todo.js";

export async function run(): Promise<number> {
  const seeded = await seedTodos();
  const updated = await completeFirst(seeded);

  let done = 0;
  for (const t of updated) {
    if (isDone(t)) done++;
  }

  return done;
}

export function main(): void {
  run().then((n) => console.log("REAL_WORLD_V1_OK:" + n));
}

