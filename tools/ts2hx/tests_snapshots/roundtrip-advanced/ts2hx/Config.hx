package ts2hx;

enum abstract Role(String) from String to String {
  var Admin = "admin";
  var User = "user";
}

typedef Config = {
  var role: Role;
  var dryRun: Bool;
  @:optional var baseUrl: String;
}

function normalizeBaseUrl(cfg: Config): String {
  var len = (cfg.baseUrl?.length ?? 0);
  if ((len == 0))   {
    return "http://localhost";
  }
  return (cfg.baseUrl);
}
