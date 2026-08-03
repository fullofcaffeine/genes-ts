package todo.server;

import genes.ts.Unknown;
import genes.ts.UnknownNarrow;
import genes.ts.UnknownRecord;
import todo.shared.Api.CreateTodoBody;
import todo.shared.TodoId;

/** Result of checking an untrusted HTTP value against one Todo API shape. */
typedef ApiDecode<T> = {
  final value: Null<T>;
  final error: String;
}

/** A non-empty Todo update after the untrusted JSON checks have passed. */
typedef DecodedTodoUpdate = {
  final ?title: String;
  final ?completed: Bool;
}

/**
 * Converts untrusted Express inputs into precise Todo API values.
 *
 * Keeping these checks outside route handlers makes the trust boundary easy
 * to audit: application code never casts a request body and the generated
 * TypeScript keeps `unknown` until the runtime checks have succeeded.
 */
class ApiRequestDecoder {
  public static function todoId(raw: Null<String>): ApiDecode<TodoId> {
    if (raw == null || StringTools.trim(raw).length == 0)
      return rejected("invalid_id");
    return accepted(new TodoId(raw));
  }

  public static function create(body: Unknown): ApiDecode<CreateTodoBody> {
    final record = UnknownNarrow.record(body);
    if (record == null || !hasCreateShape(record))
      return rejected("invalid_body");

    final title = UnknownNarrow.string(record.get("title"));
    if (title == null || StringTools.trim(title).length == 0)
      return rejected("invalid_title");

    final value: CreateTodoBody = {title: title};
    return accepted(value);
  }

  public static function update(body: Unknown): ApiDecode<DecodedTodoUpdate> {
    final record = UnknownNarrow.record(body);
    if (record == null || !hasOnlyUpdateFields(record))
      return rejected("invalid_patch");

    final hasTitle = record.hasOwn("title");
    final hasCompleted = record.hasOwn("completed");
    if (!hasTitle && !hasCompleted)
      return rejected("invalid_patch");

    if (hasTitle) {
      final title = UnknownNarrow.string(record.get("title"));
      if (title == null || StringTools.trim(title).length == 0)
        return rejected("invalid_patch");

      if (hasCompleted) {
        final completed = UnknownNarrow.bool(record.get("completed"));
        if (completed == null)
          return rejected("invalid_patch");
        final value: DecodedTodoUpdate = {
          title: title,
          completed: completed
        };
        return accepted(value);
      }

      final value: DecodedTodoUpdate = {title: title};
      return accepted(value);
    }

    final completed = UnknownNarrow.bool(record.get("completed"));
    if (completed == null)
      return rejected("invalid_patch");
    final value: DecodedTodoUpdate = {completed: completed};
    return accepted(value);
  }

  static inline function accepted<T>(value: T): ApiDecode<T>
    return {value: value, error: ""};

  static inline function rejected<T>(error: String): ApiDecode<T>
    return {value: null, error: error};

  static function hasCreateShape(record: UnknownRecord): Bool
    return record.hasOwn("title") && record.keys().length == 1;

  static function hasOnlyUpdateFields(record: UnknownRecord): Bool {
    for (key in record.keys())
      if (key != "title" && key != "completed")
        return false;
    return true;
  }
}
