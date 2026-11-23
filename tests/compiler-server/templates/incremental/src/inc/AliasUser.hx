package inc;

/** Reads `AliasModel.shape`, so its walk takes a step to the alias typedef. */
class AliasUser {
  public static function run(): String {
    final shape = new AliasModel().shape;
    return "alias" + shape.id;
  }
}
