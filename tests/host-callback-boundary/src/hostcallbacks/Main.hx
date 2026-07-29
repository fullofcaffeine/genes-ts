package hostcallbacks;

import hostcallbacks.HostCallbacks.UserCallbacks;

class Main {
  public static function main(): Void {
    final target = new UserCallbacks();
    var transcript = "";
    HostCallbacks.assignUser(target, value -> transcript = value);
    final callback: String->Void = cast target.onerror;
    callback("user-callback");
    NodeConsole.log(transcript);
  }
}
