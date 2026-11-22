package genes.ts;

#if macro
import genes.ts.SignatureCache.CachedSig;
import haxe.macro.Type;

/**
 * One fact that `SignatureCache` reads from one declaration after typing,
 * with the key under which the generator asks for it.
 *
 * Why a value and not a direct map write: the capture of one declaration is
 * then a list of facts. On a compilation server with
 * `-D genes.dev_incremental`, `SignatureCache` keeps that list as the bucket
 * of the declaration and puts the same facts back in a later request, in the
 * same order, without reading the declaration again. A direct capture and a
 * kept bucket go through the same `SignatureFacts.put`, so both give the
 * same maps.
 *
 * Example: the class `app.View` has a field `phase: Phase`, where `Phase` is
 * an enum abstract with the values `"a"` and `"b"`. Its capture gives
 * `FieldTsType("app.View::I:phase", "\"a\" | \"b\"")` and
 * `FieldSourceType("app.View::I:phase", <the type Phase>)`.
 *
 * The `Type` values are compiler-owned. A fact that holds one is valid only
 * while Haxe keeps the declaration object that it was read from; see
 * `genes.incremental.KeptBuckets` for the rule.
 */
enum SignatureFact {
  /** The arguments and the result of a method; key: owner, static flag and field name. */
  Sig(key: String, sig: CachedSig);

  /** The literal spelling of a field type, such as `"a" | "b"`; key as for `Sig`. */
  FieldTsType(key: String, tsType: String);

  /** A field type that contains an enum abstract; key as for `Sig`. */
  FieldSourceType(key: String, type: Type);

  /** The literal spelling of a field of an anonymous structure; key: its source position. */
  AnonFieldTsType(key: String, tsType: String);

  /** The type of a field of an anonymous structure; key: its source position. */
  AnonFieldSourceType(key: String, type: Type);

  /** The body of a typedef that contains an enum abstract; key: the typedef. */
  TypedefSourceType(key: String, type: Type);

  /** The declared type of a local variable; key: the variable id of Haxe. */
  LocalSourceType(id: Int, type: Type);

  /** The declared type of a local variable that is itself an enum abstract. */
  DirectEnumLocalSourceType(id: Int, type: Type);

  /** The literal spelling of an enum abstract; key: the abstract. */
  EnumAbstractTsType(key: String, tsType: String);

  /** The type of an enum constructor that contains an enum abstract; key: enum and constructor. */
  EnumConstructorSourceType(key: String, type: Type);

  /**
   * The type parameters that a local function declares (`TVar.extra`); key:
   * the variable id of Haxe. `owner` is the class whose body holds the
   * function (genes-f8vc.9.27).
   *
   * Why it is kept: the parameters reach their own class and the
   * structures in their constraints through references, so a later request
   * reads their metadata as it is then, without reading the body again.
   * `SignatureCache.localTypeParameters` records that metadata as an answer
   * of the module that prints the function.
   */
  LocalTypeParameters(owner: String, id: Int, params: Array<TypeParameter>);

  /**
   * The declared type of a local variable or argument that holds an
   * anonymous structure (`ModuleFingerprint.holdsStructure`); key: the
   * variable id of Haxe. `owner` as for `LocalTypeParameters`
   * (genes-f8vc.9.27).
   */
  LocalDeclaredType(owner: String, id: Int, type: Type);
}

/** One kept body holder of `SignatureFacts`: the class that holds it, and the value. */
typedef BodyHolder<T> = {
  final owner: String;
  final value: T;
}

/**
 * The maps that the generator reads through the getters of `SignatureCache`:
 * one map for each kind of `SignatureFact`.
 *
 * Why one object: a request has one such set, built again from nothing in
 * every request. The compare mode of `-D genes.dev_incremental` builds a
 * second set from the kept buckets and compares the answers of both.
 *
 * `put` is the only writer. A later fact with the same key replaces an
 * earlier one, as a direct map write does, so the order of the `put` calls
 * decides which declaration answers for a shared key (two declarations can
 * write one source-position key).
 *
 * Lifetime: `SignatureCache.install()` makes a new set for each compilation.
 * No set is used in a later request.
 */
class SignatureFacts {
  public final sigs: Map<String, CachedSig> = new Map();
  public final fieldTsTypes: Map<String, String> = new Map();
  public final fieldSourceTypes: Map<String, Type> = new Map();
  public final anonFieldTsTypes: Map<String, String> = new Map();
  public final anonFieldSourceTypes: Map<String, Type> = new Map();
  public final typedefSourceTypes: Map<String, Type> = new Map();
  public final localSourceTypes: Map<Int, Type> = new Map();
  public final directEnumLocalSourceTypes: Map<Int, Type> = new Map();
  public final enumAbstractTsTypes: Map<String, String> = new Map();
  public final enumConstructorSourceTypes: Map<String, Type> = new Map();
  public final localTypeParameters: Map<Int,
    BodyHolder<Array<TypeParameter>>> = new Map();
  public final localDeclaredTypes: Map<Int, BodyHolder<Type>> = new Map();

  public function new() {}

  /** Stores one fact in the map of its kind and replaces an earlier fact with the same key. */
  public function put(fact: SignatureFact): Void {
    switch fact {
      case Sig(key, sig):
        sigs.set(key, sig);
      case FieldTsType(key, tsType):
        fieldTsTypes.set(key, tsType);
      case FieldSourceType(key, type):
        fieldSourceTypes.set(key, type);
      case AnonFieldTsType(key, tsType):
        anonFieldTsTypes.set(key, tsType);
      case AnonFieldSourceType(key, type):
        anonFieldSourceTypes.set(key, type);
      case TypedefSourceType(key, type):
        typedefSourceTypes.set(key, type);
      case LocalSourceType(id, type):
        localSourceTypes.set(id, type);
      case DirectEnumLocalSourceType(id, type):
        directEnumLocalSourceTypes.set(id, type);
      case EnumAbstractTsType(key, tsType):
        enumAbstractTsTypes.set(key, tsType);
      case EnumConstructorSourceType(key, type):
        enumConstructorSourceTypes.set(key, type);
      case LocalTypeParameters(owner, id, params):
        localTypeParameters.set(id, {owner: owner, value: params});
      case LocalDeclaredType(owner, id, type):
        localDeclaredTypes.set(id, {owner: owner, value: type});
    }
  }
}
#end
