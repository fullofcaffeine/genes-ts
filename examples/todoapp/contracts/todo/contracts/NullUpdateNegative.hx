package todo.contracts;

import todo.web.Client;

/**
 * Compile-failure witness for the Todoapp's public Haxe client boundary.
 *
 * The build script expects Haxe null safety to reject this call. Keeping the
 * witness separate from application source makes the invalid example explicit
 * without weakening or conditionally changing the maintained Todo behavior.
 */
class NullUpdateNegative {
  static function main(): Void {
    Client.updateTodoCompleted("todo-1", null);
  }
}
