import haxe.extern.EitherType;

enum abstract TextOnlyRole(String) from String to String {
  var Text = "text";
}

enum abstract ToolOnlyRole(String) from String to String {
  var Tool = "tool";
}

typedef TextMessage = {
  final role: TextOnlyRole;
  final text: String;
}

typedef ToolMessage = {
  final role: ToolOnlyRole;
  final id: String;
}

typedef Message = EitherType<TextMessage, ToolMessage>;

class Main {
  public static function textMessage(text: String): TextMessage {
    return {role: TextOnlyRole.Text, text: text};
  }

  public static function toolMessage(id: String): ToolMessage {
    return {role: ToolOnlyRole.Tool, id: id};
  }

  public static function chooseMessage(useTool: Bool): Message {
    return useTool ? toolMessage("tool-1") : textMessage("hello");
  }

  public static function main(): Void {
    chooseMessage(false);
  }
}
