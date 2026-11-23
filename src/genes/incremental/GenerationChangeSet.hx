package genes.incremental;

#if macro
import genes.DependencyPlan;
import genes.incremental.IncrementalRequest.AfterTypingReuse;
import genes.incremental.IncrementalRequest.GenerationReuse;
import genes.incremental.IncrementalRequest.IncrementalDescriptor;
import genes.incremental.KeptRecords.KeptRecordsReport;
import haxe.crypto.Sha256;
import haxe.io.Path;
import haxe.macro.Compiler;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;
import sys.FileSystem;
import sys.io.File;

/** How one declaration arrived in this request. */
enum DeclarationArrival {
  /**
   * It carried no stamp. Haxe typed it in this request, or no earlier request
   * could stamp it. It has a stamp of this request now.
   */
  TypedAgain;

  /** It carried one stamp that names it. Haxe kept the declaration object. */
  Kept;

  /**
   * It carried a stamp that names another declaration, or more than one
   * stamp, or a stamp that cannot be read. Example: a macro defined the type
   * with the metadata of another class. It has a stamp of this request now.
   */
  ForeignStamp;
}

/** One declaration of this request, with the stamp that it carries now. */
typedef StampedDeclaration = {
  /** The declaration key, for example `class:app.Models.User`. */
  final key: String;

  /** The Haxe module of the declaration. */
  final module: String;

  /** The stamp as `nonce:N`. */
  final stamp: String;

  final arrival: DeclarationArrival;
}

/**
 * One declaration of this request, as the change set read it: the class
 * record that the walk reads next, and the stamp.
 */
typedef ObservedDeclaration = {
  /** The class record, so that the walk does not copy it again; `null` for another kind. */
  final type: Null<ClassType>;

  /** `null` when the request left the incremental path (an `@:rtti` class). */
  final stamp: Null<StampedDeclaration>;

  /**
   * The fields of the class that the metadata comparison read, so that the
   * walk does not copy them again; `null` when it did not read them.
   */
  final parts: Null<ModuleFingerprint.ClassParts>;
}

/** Why the keep rule rejects a record. */
enum KeepReject {
  /** The pass has no record for the declaration under this session key. */
  NoRecord;

  /** Condition 3: the declaration arrived without a stamp. */
  TypedAgain;

  /** Condition 3: the declaration arrived with a stamp for another declaration. */
  StampNamesOtherDeclaration;

  /** Condition 4: the record was written for another stamp. */
  StampDiffers;

  /**
   * Condition 5: the typed values of the bucket address another declaration
   * object than the one that Haxe gives now.
   */
  OtherObject;

  /** Condition 6: the class has another member list than the record says. */
  MembersChanged;
}

/** The answer of the keep rule for one record. */
enum KeepDecision {
  /** Every condition holds: the pass may use the record. */
  Keep;

  /** One condition does not hold: the pass must do its full work. */
  Reject(reason: KeepReject);
}

/** Whether this request has the session key of the earlier request. */
enum SessionState {
  /** No earlier request of this macro interpreter had a session key. */
  First;

  /** The key equals the key of the earlier request. */
  Same;

  /** The key differs. Every kept record was dropped. */
  Changed;
}

/** The time of one pass after typing in one request. */
typedef PassTime = {
  /** The name that the pass gave to `AfterTypingPasses.add`. */
  final pass: String;

  /** Time of the class function of the pass, over all classes. */
  final classMs: Float;

  /** Time of the declaration function of the pass; 0 when it has none. */
  final declarationsMs: Float;
}

/** The report that one request writes beside its descriptor. */
typedef AfterTypingReport = {
  /** The report format; `GenerationChangeSet.FORMAT`. */
  final format: Int;

  /** The request number inside this macro interpreter; 0 when no stamp was added. */
  final request: Int;

  /** The name of this life of the macro interpreter; empty before the first stamp. */
  final nonce: String;

  /** `measure`, `reuse`, `compare`, or `off`. */
  final mode: String;

  /** Why the mode is `off`, else `null`. */
  final reason: Null<String>;

  /** `first`, `same` or `changed`; `none` when the mode is `off`. */
  final session: String;

  /** Records of all passes that a changed session key dropped. */
  final droppedRecords: Int;

  /** Declarations that Haxe gave to the after-typing callback in this request. */
  final declarations: Int;

  /** The classes among `declarations`. Each class gets one keep decision of each pass. */
  final classes: Int;

  /** Declarations that arrived without a stamp: Haxe typed them in this request. */
  final typedAgain: Int;

  /** Declarations that arrived with one stamp that names them: Haxe kept the object. */
  final arrivedStamped: Int;

  /** Declarations that arrived with a stamp of another declaration, or an unreadable one. */
  final foreignStamps: Int;

  /** Modules with a declaration that arrived without a valid stamp (at most 100). */
  final typedAgainModules: Array<String>;

  /** The number of those modules, without the limit of the list. */
  final typedAgainModuleCount: Int;

  /** Time to read and add the stamps. */
  final stampMs: Float;

  /**
   * Time to compute the session key, with the comparison of the metadata of
   * every module that comes before it (`compareMetadata`).
   */
  final sessionKeyMs: Float;

  /** Time to read the member list of each class. */
  final memberListMs: Float;

  /** Time of the class walk and the declaration functions of all passes. */
  final walkMs: Float;

  /**
   * The part of `walkMs` that each pass used, in the order of the passes.
   * Empty in a report that was written before the passes ended.
   */
  final passTimes: Array<PassTime>;

  /** False in a report that was written before the passes ended. */
  final passesComplete: Bool;

  /** One entry for each pass that used its records in this request, by name. */
  final passes: Array<KeptRecordsReport>;
}

/**
 * Says, for each declaration of a request, whether Haxe kept the declaration
 * object from an earlier request, and decides whether a pass may keep a
 * record that it made in an earlier request (the keep rule).
 *
 * Why: three Genes passes read every class after typing on every request of
 * a warm compilation server, also the classes that Haxe did not type again.
 * To do that work only for new classes, a pass keeps a record for each class
 * and must know when the record is still valid. Haxe gives a macro no list of
 * the modules that it typed again. But metadata that a macro adds to a
 * declaration stays on it while Haxe keeps the declaration in its cache, and
 * a declaration that Haxe typed again is a new object without it.
 *
 * The stamp: each declaration gets `@:genes.typedEpoch(nonce, N, key)` the
 * first time this owner sees it. `nonce` names one life of the macro
 * interpreter, `N` the request, and `key` the declaration, for example
 * `class:app.Models.User`. The key is there because a macro can copy
 * metadata: `Context.defineType` with the metadata of another class gives a
 * new type that carries the stamp of that class. A stamp counts only on the
 * declaration that it names.
 *
 * The keep rule. A pass keeps a record only when all of these hold:
 *
 * 1. The request is eligible (`IncrementalRequest`): the define is on, the
 *    Haxe version is proved, it is no display request, and the program has no
 *    `@:rtti` class.
 * 2. The session key is the one of the earlier request. The key is the
 *    text of the inputs that change what a pass or the generator computes
 *    but not always what Haxe types: the format, the Haxe version, every
 *    define at the first after-typing callback, the session's digest of the
 *    argument list, the output file name and the way from the output folder
 *    to the project root (`outputKeyLines`; not the absolute output path),
 *    the class paths in order, the working folder, the name and content of
 *    each embedded resource, the status of each `.hx` file under the
 *    Genes class path, and the metadata epoch (`compareMetadata`: it grows
 *    when a macro changed the metadata of a module that Haxe did not type
 *    again).
 *    When it differs, every record of every pass is dropped, and the
 *    generation cache does not use its stored output.
 * 3. The declaration arrived with one stamp, and the stamp names it.
 * 4. That stamp equals the stamp in the record, and the same pass wrote the
 *    record (each pass has its own `KeptRecords`).
 * 5. The typed values of a bucket address the declaration object of this
 *    request (the same-object test, `sameObject`). A bucket of
 *    `KeptBuckets` holds the declaration reference that Haxe gave when the
 *    bucket was made. The test writes one metadata entry through that
 *    reference, reads it through the reference of this request, and removes
 *    it. A plain record of `KeptRecords` holds no typed value and no
 *    reference, so it has nothing to test and nothing that can be stale; the
 *    condition does not apply to it.
 * 6. For a class, the member list equals the one in the record. Haxe adds a
 *    static field to a class that it did not type again when another module
 *    first uses a `@:generic` method of it.
 *
 * Example: `app.Leaf` is edited. Haxe types `app.Leaf` again; it arrives
 * without a stamp, so every record for it is rejected (`TypedAgain`). All
 * other classes arrive with the stamps of the first request, and their
 * records are kept.
 *
 * Common mistake that the rule prevents: "the stamp is present" is not
 * "kept". When an init macro sets a define, Haxe reads most modules from
 * another cache while the macro state stays; those objects carry stamps of
 * other requests than the records.
 *
 * One owner, several readers (design review R5): the stamps, the session key
 * and the change set are computed here once, at the start of the first
 * after-typing callback of the passes. The readers are the passes after
 * typing (through `KeptRecords` and `keep`) and the generation shadow
 * (`IncrementalShadow` and `GenerationCache`, through `epochs`,
 * `retypedModules`, `sessionKey` and `reservedNameDigest`). No reader adds a
 * stamp or builds a key of its own.
 *
 * For the generation readers, for one request:
 *
 * - `epochs(module)`: the sorted `declaration key@nonce:N` list of the
 *   module. Two equal lists mean that Haxe did not type the module again and
 *   that no declaration was added or removed.
 * - `retypedModules()`: modules with a declaration that got its stamp in
 *   this request.
 * - `reservedNameDigest()`: digest of the names that Haxe's local-rename
 *   filter reserves (`renameVars.ml`, `reserve_all_types`). The Stage 3
 *   review expected that a new top-level name renames locals of every module
 *   in a cold build while cached modules keep their old names. The fixture
 *   showed no such difference, so the digest is reported only. It is read
 *   only when the descriptor has a `generation` value.
 *
 * How: `AfterTypingPasses.run` calls `observe` first, for each declaration
 * list that Haxe gives to `onAfterTyping`. That is before dead-code
 * elimination and before Haxe saves the class state that a cached class
 * returns to, so a new stamp survives in the cache. A stamp of an earlier
 * macro interpreter stays valid as the name of that object and is not
 * replaced: Haxe restores the metadata of a cached class in each request, so
 * a replaced stamp would be lost and the class would look typed again in
 * every request.
 *
 * `@:rtti`: Haxe prints the metadata of an `@:rtti` class into its `__rtti`
 * string after this callback. A stamp would then reach output, so a program
 * with such a class gets no stamp and leaves the incremental path.
 *
 * Limits: the `Retype` module check policy types a module again in place,
 * with the same object and the same stamp. No stamp can show that, so the
 * session must not use that policy. A class that Haxe first typed in a
 * request that added no stamp counts as typed again on every request until
 * Haxe types it again: safe, but slow.
 *
 * Lifetime: only the nonce, the request counter, the last session key, the
 * metadata digest of each module and the metadata epoch are `@:persistent`. They are plain text and numbers. Every other field is an
 * ordinary static that Haxe replaces at the start of each compilation, and
 * none of them holds a compiler value (the maps hold text only). Without
 * `-D genes.dev_incremental` nothing here runs.
 */
class GenerationChangeSet {
  /** The metadata name of the stamp. */
  public static inline final EPOCH_META = ':genes.typedEpoch';

  /** The metadata name that the same-object test adds and removes again. */
  public static inline final SAME_OBJECT_META = ':genes.sameObject';

  /** The format of the kept records, of the kept buckets and of the report. */
  public static inline final FORMAT = 2;

  static inline final MODULE_LIMIT = 100;

  @:persistent static var nonce: Null<String> = null;
  @:persistent static var requestCounter = 0;
  @:persistent static var lastSessionKey: Null<String> = null;

  /**
   * The metadata digest of each module (`ModuleFingerprint.addDeclaration`
   * over all its declarations) in the last request that observed it. Plain
   * text; see `settleRequest`.
   */
  @:persistent static var metadataDigests: Map<String, String> = new Map();

  /**
   * For each module, the digest of each line of that text, by line key
   * (`metadataLines`). Made again only when the module digest changes.
   */
  @:persistent static var metadataLineDigests: Map<String, Map<String,
    String>> = new Map();

  /**
   * Grows by one in each request in which a module that Haxe did not type
   * again has another metadata digest than before. The session key holds it.
   */
  @:persistent static var metadataEpoch = 0;

  static var requestNumber = 0;
  static var session: Null<SessionState> = null;
  static var droppedRecords = 0;
  static var declarations = 0;
  static var classes = 0;
  static var typedAgain = 0;
  static var arrivedStamped = 0;
  static var foreignStamps = 0;
  static var typedAgainModules: Map<String, Bool> = new Map();

  /** Modules with a declaration that arrived `Kept` in this request (`keptModules`). */
  static var keptModuleSet: Map<String, Bool> = new Map();

  static var moduleEpochs: Map<String, Array<String>> = new Map();
  static var reservedNames: Map<String, Bool> = new Map();
  static var reservedDigest: Null<String> = null;
  static var typingResources: Null<String> = null;
  static var typingDefines: Null<String> = null;
  static var passOrder: Array<String> = [];
  static var passClassSeconds: Map<String, Float> = new Map();
  static var passDeclarationSeconds: Map<String, Float> = new Map();
  static var stampSeconds = 0.0;
  static var sessionKeySeconds = 0.0;
  static var memberSeconds = 0.0;
  static var walkSeconds = 0.0;
  static var complete = false;
  static var reportWarned = false;
  static var sameObjectTokens = 0;
  static var objectProofs: Map<String, String> = new Map();
  static var objectFailures: Map<String, Bool> = new Map();
  static var metadataChangedModules: Array<String> = [];

  /**
   * Stamps one declaration list that Haxe gave to `onAfterTyping` and
   * returns the stamp of each declaration, and for a class also the class
   * record. The array has one entry for each entry of `types`, in the same
   * order.
   *
   * Returns `null` when the request does not use the incremental path. Then
   * nothing was read and nothing was added.
   *
   * Haxe may call the callback again in one request, when a callback defines
   * new types; those declarations are new, so they arrive without a stamp.
   */
  public static function observe(types: Array<ModuleType>): Null<Array<ObservedDeclaration>> {
    final descriptor = switch IncrementalRequest.mode() {
      case Absent:
        return null;
      case Off(_, _):
        writeReport();
        return null;
      case On(descriptor):
        descriptor;
    }
    final started = haxe.Timer.stamp();
    final records: Array<Null<ClassType>> = [];
    var rtti = false;
    for (type in types) {
      switch type {
        case TClassDecl(reference):
          final record = reference.get();
          records.push(record);
          if (record.meta.has(':rtti'))
            rtti = true;
        default:
          records.push(null);
      }
    }
    if (rtti) {
      IncrementalRequest.turnOff('the program has an @:rtti class: Haxe '
        + 'prints its metadata into __rtti, so a stamp would reach output');
      stampSeconds += haxe.Timer.stamp() - started;
      writeReport();
      return [for (record in records) {type: record, stamp: null, parts: null}];
    }
    var keySeconds = 0.0;
    final first = requestNumber == 0;
    if (first) {
      requestCounter++;
      requestNumber = requestCounter;
    }
    final currentNonce = interpreterNonce();
    final pos = Context.currentPos();
    final reserve = descriptor.generation != Regenerate;
    final observed: Array<ObservedDeclaration> = [];
    final kept: Array<Bool> = [];
    final parts: Array<Null<ModuleFingerprint.ClassParts>> = [];
    for (index => type in types) {
      final record = records[index];
      final base: BaseType = record != null ? record : DependencyPlan.moduleTypeBase(type);
      final stamped = stamp(base, DependencyPlan.moduleTypeKeyOf(type, base),
        currentNonce, pos);
      declarations++;
      final entry = '${stamped.key}@${stamped.stamp}';
      final list = moduleEpochs.get(base.module);
      if (list == null)
        moduleEpochs.set(base.module, [entry]);
      else
        list.push(entry);
      if (reserve)
        reserveNames(type, base, record);
      switch stamped.arrival {
        case Kept:
          arrivedStamped++;
          keptModuleSet.set(base.module, true);
        case TypedAgain:
          typedAgain++;
          typedAgainModules.set(base.module, true);
        case ForeignStamp:
          foreignStamps++;
          typedAgainModules.set(base.module, true);
      }
      if (record != null)
        classes++;
      kept.push(stamped.arrival == Kept);
      // Only the first list is compared (`compareMetadata`); the walk then
      // reuses these fields.
      final read = first
        && record != null ? ModuleFingerprint.classParts(record) : null;
      parts.push(read);
      observed.push({type: record, stamp: stamped, parts: read});
    }
    if (first) {
      beginRequest(descriptor, types, records, parts, kept);
      keySeconds = sessionKeySeconds;
    }
    reservedDigest = null;
    stampSeconds += haxe.Timer.stamp() - started - keySeconds;
    writeReport();
    return observed;
  }

  /**
   * Returns the epoch list of one module as one text: its sorted
   * `declaration key@nonce:N` entries. Empty when Haxe gave no declaration of
   * the module to the after-typing callback, or when the request added no
   * stamp.
   *
   * Example: `class:app.Leaf@ab12cd34ef567890:3`. The generation cache keeps
   * the text of a module with its stored output; an equal text in a later
   * request says that Haxe did not type the module again and that no
   * declaration was added or removed.
   */
  public static function epochs(module: String): String {
    final list = moduleEpochs.get(module);
    if (list == null)
      return '';
    final sorted = list.copy();
    sorted.sort(compareStrings);
    return sorted.join('\n');
  }

  /**
   * Returns the sorted modules of every declaration that the after-typing
   * callback saw in this request, stamped or not. Empty when the request
   * added no stamp.
   *
   * Why: a module request (`ModuleRequest`) must know that every module of
   * its program, other than the requested one, is the module of the last
   * full request. It compares `epochs` of each of these modules with the
   * stored ones.
   */
  public static function observedModules(): Array<String> {
    final names = [for (name in moduleEpochs.keys()) name];
    names.sort(compareStrings);
    return names;
  }

  /**
   * Returns the stamp (`nonce:N`) of one declaration of `module` in this
   * request, or an empty text when the after-typing callback saw no such
   * declaration or the request added no stamp.
   *
   * Why: a stored step of the reachability walk (Stage 3, slice S2) names a
   * declaration by its key. Before the walk with stored edges adds that
   * declaration again, the stamp must equal the stamp of the recording
   * request: then Haxe kept the declaration object, and the typed value
   * found by the key is the one that the live edge would carry. Example:
   * `stampOf('inc.Den', 'class:inc.Den.DenNote')` gives
   * `ab12cd34ef567890:3`.
   *
   * An import alias (`TypedModuleInventory.importAlias`) has no stamp of its
   * own. Its stamp is `alias:` and a digest of `epochs(module)`: equal in a
   * later request only when Haxe kept every declaration of the module, and
   * so the alias object too. Example: `stampOf('inc.AliasModel',
   * 'typedef:inc.AliasModel.AliasedShape')`.
   */
  public static function stampOf(module: String, key: String): String {
    final list = moduleEpochs.get(module);
    if (list == null)
      return '';
    final prefix = '$key@';
    for (entry in list)
      if (StringTools.startsWith(entry, prefix))
        return entry.substr(prefix.length);
    // An import alias has no stamp of its own (genes-44h0). Haxe makes it
    // while it types its module, and makes a new one only when it types
    // that module again, which gives every declaration of the module a new
    // stamp. So the epochs of the module name the alias object.
    if (genes.TypedModuleInventory.importAlias(module, key) != null)
      return 'alias:' + Context.signature(epochs(module));
    return '';
  }

  /**
   * Returns the sorted modules with a declaration that arrived without a
   * valid stamp: Haxe typed them in this request, or a macro defined them.
   */
  public static function retypedModules(): Array<String> {
    final names = [for (name in typedAgainModules.keys()) name];
    names.sort(compareStrings);
    return names;
  }

  /**
   * Returns the sorted modules with a declaration that arrived with its own
   * stamp of an earlier request: Haxe kept that declaration object from its
   * cache and did not type it again in this request. Empty when the request
   * added no stamp.
   *
   * Why: `ModuleRequest` makes Haxe parse a changed file again before the
   * program is typed, but Haxe can load a module from its cache earlier than
   * that (genes-v54c). Example: a global `@:build` macro that called
   * `Context.getType('app.Config')` while Haxe built a standard type in an
   * earlier request made that type depend on `app.Config`, and Haxe loads
   * `String`, `Array` and `StdTypes` with every dependency before any init
   * macro. A module of a changed file that is in this list was typed from
   * old text. A module can be here and in `retypedModules` at once when a
   * macro added a declaration to a kept module.
   */
  public static function keptModules(): Array<String> {
    final names = [for (name in keptModuleSet.keys()) name];
    names.sort(compareStrings);
    return names;
  }

  /**
   * Returns the session key text of this request, or `null` when the request
   * added no stamp (it is not eligible, or typing did not end).
   *
   * Every consumer compares this one text; none builds a key of its own.
   */
  public static function sessionKey(): Null<String> {
    return requestNumber == 0 ? null : lastSessionKey;
  }

  /**
   * Returns one text for the resources that the build embeds at the time of
   * the call: one line `resource <name as hexadecimal> <length> <SHA-1>` for
   * each resource, sorted. Empty without a resource.
   *
   * Why: the module `haxe.Resource` prints the resource bytes into its
   * output. A session can change a resource file and no Haxe source
   * (`-resource note.txt@note` with the same argument list). Haxe then types
   * no module again, so no stamp shows the change. The session key holds this
   * text, so such an edit changes the key.
   *
   * How: `Context.getResources` copies every resource into the macro
   * interpreter. SHA-1 is a native function of that interpreter, so the
   * digest costs little. The name is written in hexadecimal because Haxe
   * 4.3.7 marks each name as ASCII text, also when it holds UTF-8 bytes;
   * reading one character of such a name stops the compiler.
   */
  public static function resourceDigest(): String {
    final lines = [];
    for (name => data in Context.getResources())
      lines.push('resource ${haxe.io.Bytes.ofString(name).toHex()} '
        + '${data.length} ${haxe.crypto.Sha1.make(data).toHex()}\n');
    lines.sort(compareStrings);
    return lines.join('');
  }

  /**
   * Returns the resource text that is part of this request's session key
   * (read at the first after-typing callback), or `null` when the request
   * added no stamp.
   *
   * A reader that prints resources later in the request compares this text
   * with `resourceDigest()` then: a macro can add a resource after typing.
   */
  public static function sessionResources(): Null<String> {
    return requestNumber == 0 ? null : typingResources;
  }

  /**
   * Returns the define lines of the session key, read at the time of the
   * call: one line `define <name>=<value>` for each define, sorted by name.
   */
  public static function defineLines(): String {
    final defines = Context.getDefines();
    final names = [for (name in defines.keys()) name];
    names.sort(compareStrings);
    final buffer = new StringBuf();
    for (name in names)
      buffer.add('define $name=${defines.get(name)}\n');
    return buffer.toString();
  }

  /**
   * Returns true when the defines now differ from the define lines of the
   * session key, which the first after-typing callback of Genes read. False
   * before that callback, and in a request that left the incremental path.
   *
   * Why: a macro can call `Compiler.define` later, for example in an
   * after-typing callback that runs after the passes of Genes. Printing
   * reads the defines of this moment. Example:
   * `Compiler.define('genes.disable_native_accessors', '1')` makes every
   * module with a native accessor print another file, but the session key
   * does not change, so a stored output or a module preview would be stale.
   * Like `sessionResources`, the generation shadow then turns itself off
   * for the request, and a module request is refused (`defines-changed`).
   */
  public static function definesChangedAfterTyping(): Bool {
    final typed = typingDefines;
    return requestNumber != 0 && typed != null && typed != defineLines();
  }

  /**
   * Returns the digest of the names that Haxe's rename filter reserves. The
   * names are collected only when the descriptor has a `generation` value.
   */
  public static function reservedNameDigest(): String {
    final known = reservedDigest;
    if (known != null)
      return known;
    final names = [for (name in reservedNames.keys()) name];
    names.sort(compareStrings);
    final computed = Sha256.encode(names.join('\n'));
    reservedDigest = computed;
    return computed;
  }

  /**
   * Returns the seconds that this owner used in this request to read and add
   * the stamps and to build the session key.
   */
  public static function overheadSeconds(): Float {
    return stampSeconds + sessionKeySeconds;
  }

  /**
   * Decides whether a record of an earlier request is still valid for
   * `declaration` (conditions 3 to 6 of the keep rule; see the class comment
   * for 1 and 2).
   *
   * `recordStamp` and `recordMembers` come from the record of the calling
   * pass; pass `null` for both when the pass has no record. `members` returns
   * the member list of the class now, or `null` for a declaration that is not
   * a class. `sameObject` runs the same-object test of a bucket that holds
   * typed values; a plain record passes `null`. Both functions are called
   * only when the stamps agree, the same-object test first.
   */
  public static function keep(declaration: StampedDeclaration,
      recordStamp: Null<String>, recordMembers: Null<String>,
      members: Void->Null<String>, ?sameObject: Void->Bool): KeepDecision {
    if (recordStamp == null)
      return Reject(NoRecord);
    switch declaration.arrival {
      case TypedAgain:
        return Reject(TypedAgain);
      case ForeignStamp:
        return Reject(StampNamesOtherDeclaration);
      case Kept:
    }
    if (recordStamp != declaration.stamp)
      return Reject(StampDiffers);
    if (sameObject != null && !sameObject())
      return Reject(OtherObject);
    if (recordMembers != members())
      return Reject(MembersChanged);
    return Keep;
  }

  /**
   * Returns true when `kept`, a declaration reference of an earlier request,
   * and `current`, the reference that Haxe gives now, address one compiler
   * object (condition 5 of the keep rule).
   *
   * Why: a bucket holds typed values that were read through `kept`. They are
   * valid only for that declaration object. Equal stamps say that the object
   * is the same in every case that the probe found, but a macro can give a
   * new object an old stamp, so the bucket proves the identity itself.
   *
   * How: each `get()` of a reference copies the declaration record, so two
   * macro values are never one macro object. The test adds one metadata
   * entry through `kept`, looks for it through `current`, and removes it
   * through the same copy that added it. Nothing else changes the metadata
   * between the two writes, so the list is the same afterwards. When `kept`
   * is another object, the entry goes to that object and comes off again.
   *
   * Example: `Context.defineType` makes `app.Clone` again with the same
   * stamp text. The bucket's reference addresses the first `app.Clone`; the
   * entry does not appear on the new one, and the answer is false.
   */
  public static function sameObject(kept: ModuleType,
      current: ModuleType): Bool {
    final token = '$requestNumber/${sameObjectTokens++}';
    final pos = Context.currentPos();
    final old = DependencyPlan.moduleTypeBase(kept);
    old.meta.add(SAME_OBJECT_META,
      [{expr: EConst(CString(token, DoubleQuotes)), pos: pos}], pos);
    var found = false;
    for (entry in DependencyPlan.moduleTypeBase(current)
      .meta.extract(SAME_OBJECT_META))
      switch entry.params {
        case [{expr: EConst(CString(value, _))}] if (value == token):
          found = true;
        default:
      }
    old.meta.remove(SAME_OBJECT_META);
    return found;
  }

  /**
   * Records the answer of one same-object test of a kept bucket in this
   * request. `writtenIn` is the request that wrote the bucket.
   *
   * Why (item 1 of the review of #243, the copied-stamp hole): a macro can
   * give a new declaration object the stamp of the old one, for example by
   * defining the type again with the metadata of the earlier type. The
   * epochs are then equal, but the declaration is another object, possibly
   * with other content. Only the same-object test of a bucket sees that. The
   * generation cache reads these records (`declarationProofs`,
   * `sameObjectFailures`): a failed test makes the request fall back, and a
   * module is clean only when every declaration has a proof.
   */
  public static function recordSameObject(key: String, same: Bool,
      writtenIn: Int): Void {
    if (!same) {
      objectFailures.set(key, true);
      objectProofs.remove(key);
      return;
    }
    if (!objectFailures.exists(key))
      objectProofs.set(key, Std.string(writtenIn));
  }

  /**
   * Records that a pass wrote a new kept bucket for `key` in this request,
   * from the declaration object of this request. That bucket is a proof for
   * this request's object: a later request that tests the same bucket proves
   * that it has the same object.
   */
  public static function recordBucketWritten(key: String): Void {
    if (!objectFailures.exists(key))
      objectProofs.set(key, Std.string(requestNumber));
  }

  /**
   * Returns the same-object proofs of the declarations of one module, as one
   * text: sorted `declaration key@request` lines, where `request` names the
   * kept bucket that proved the object in this request. Returns `null` when
   * a declaration of the module has no proof (no bucket was tested or
   * written for it), or when the module has no observed declaration.
   *
   * Why: the generation cache stores this text with the output of a module.
   * A later request in which the same buckets prove the objects again has
   * the same declaration objects as the request that printed the stored
   * output: each bucket holds the reference of the object that it was
   * written from, and each test proves that the current object is that one.
   * A bucket that was written again after the stored output (for example in
   * a request without a `generation` value, after a macro replaced the
   * object) has another request number, so the text differs.
   */
  public static function declarationProofs(module: String): Null<String> {
    final list = moduleEpochs.get(module);
    if (list == null || list.length == 0)
      return null;
    final lines = [];
    for (entry in list) {
      final at = entry.lastIndexOf('@');
      final key = at < 0 ? entry : entry.substr(0, at);
      final proof = objectProofs.get(key);
      if (proof == null)
        return null;
      lines.push('$key@$proof');
    }
    lines.sort(compareStrings);
    return lines.join('\n');
  }

  /**
   * Returns the sorted declaration keys whose same-object test failed in
   * this request: the declaration carries a stamp that names it, but it is
   * not the object that the kept bucket was written from.
   */
  public static function sameObjectFailures(): Array<String> {
    final keys = [for (key in objectFailures.keys()) key];
    keys.sort(compareStrings);
    return keys;
  }

  /** Returns what the passes do with a kept record in this request. */
  public static function reuse(): AfterTypingReuse {
    final descriptor = IncrementalRequest.descriptor();
    return descriptor == null ? Measure : descriptor.afterTyping;
  }

  /** Returns the request number that this request stamps with, or 0 before typing. */
  public static function request(): Int {
    return requestNumber;
  }

  /**
   * Reads the member list of one class through `read` and adds the time to
   * the report. The walk calls it once for each class, before the passes, so
   * that the report shows what the keep rule costs when no pass reads the
   * fields.
   */
  public static function readMembers(read: Void->String): Void {
    final started = haxe.Timer.stamp();
    read();
    memberSeconds += haxe.Timer.stamp() - started;
  }

  /**
   * Adds the time that one pass used in the walk of one declaration list.
   * `AfterTypingPasses.run` calls it after the walk, once for the class
   * function and once for the declaration function of each pass.
   */
  public static function passTime(pass: String, classSeconds: Float,
      declarationSeconds: Float): Void {
    if (!passClassSeconds.exists(pass)) {
      passOrder.push(pass);
      passClassSeconds.set(pass, 0.0);
      passDeclarationSeconds.set(pass, 0.0);
    }
    final classBefore = passClassSeconds.get(pass);
    final declarationBefore = passDeclarationSeconds.get(pass);
    passClassSeconds.set(pass,
      (classBefore == null ? 0.0 : classBefore) + classSeconds);
    passDeclarationSeconds.set(pass,
      (declarationBefore == null ? 0.0 : declarationBefore) +
      declarationSeconds);
  }

  /** Ends the walk of one declaration list and writes the complete report. */
  public static function finish(seconds: Float): Void {
    walkSeconds += seconds;
    complete = true;
    writeReport();
  }

  /**
   * Writes the report of this request beside the descriptor. Each call
   * replaces the file, so a request that stops with an error leaves the
   * report of the last step that it reached.
   *
   * The report is evidence, not output. When the file cannot be written (for
   * example the folder of the descriptor does not exist), the request gets
   * one warning and goes on; a build never fails because of the report.
   */
  public static function writeReport(): Void {
    final path = switch IncrementalRequest.mode() {
      case Absent | Off('', _): return;
      case Off(descriptorPath, _): descriptorPath;
      case On(descriptor): descriptor.path;
    }
    final off = switch IncrementalRequest.mode() {
      case Off(_, reason): reason;
      case Absent | On(_): null;
    }
    final modules = [for (module in typedAgainModules.keys()) module];
    modules.sort(compareStrings);
    final known = session;
    final report: AfterTypingReport = {
      format: FORMAT,
      request: requestNumber,
      nonce: nonce == null ? '' : nonce,
      mode: off != null ? 'off' : switch reuse() {
        case Measure: 'measure';
        case Reuse: 'reuse';
        case Compare: 'compare';
      },
      reason: off,
      session: known == null ? 'none' : switch known {
        case First: 'first';
        case Same: 'same';
        case Changed: 'changed';
      },
      droppedRecords: droppedRecords,
      declarations: declarations,
      classes: classes,
      typedAgain: typedAgain,
      arrivedStamped: arrivedStamped,
      foreignStamps: foreignStamps,
      typedAgainModules: modules.slice(0, MODULE_LIMIT),
      typedAgainModuleCount: modules.length,
      stampMs: milliseconds(stampSeconds),
      sessionKeyMs: milliseconds(sessionKeySeconds),
      memberListMs: milliseconds(memberSeconds),
      walkMs: milliseconds(walkSeconds),
      passTimes: [
        for (pass in passOrder) {
          final classSeconds = passClassSeconds.get(pass);
          final declarationSeconds = passDeclarationSeconds.get(pass);
          {
            pass: pass,
            classMs: milliseconds(classSeconds == null ? 0.0 : classSeconds),
            declarationsMs: milliseconds(declarationSeconds == null ? 0.0 : declarationSeconds)
          }
        }
      ],
      passesComplete: complete,
      passes: off != null ? [] : KeptRecords.reports()
    };
    final file = IncrementalRequest.afterTypingReportPath(path);
    try {
      File.saveContent(file, haxe.Json.stringify(report, null, ' ') + '\n');
    } catch (error:haxe.Exception) {
      if (!reportWarned) {
        reportWarned = true;
        Context.warning('[GENES-INCREMENTAL-REPORT-001] Genes cannot write the '
          + 'after-typing report $file (${error.message}). The build '
          + 'continues without it.',
          Context.currentPos());
      }
    }
  }

  /** Rounds seconds to milliseconds with two decimal places. */
  public static function milliseconds(seconds: Float): Float {
    return Math.round(seconds * 100000) / 100;
  }

  /**
   * Settles the request after its first declaration list was stamped:
   * compares the metadata of each module with the earlier request
   * (`compareMetadata`), computes the session key once, and drops every
   * record when the key is not the one of the earlier request. For each
   * entry of `types`, `records` holds the class record and `parts` its
   * fields (for a class), and `kept` whether it arrived with its stamp.
   */
  static function beginRequest(descriptor: IncrementalDescriptor,
      types: Array<ModuleType>, records: Array<Null<ClassType>>,
      parts: Array<Null<ModuleFingerprint.ClassParts>>,
      kept: Array<Bool>): Void {
    final started = haxe.Timer.stamp();
    compareMetadata(types, records, parts, kept);
    final key = sessionKeyOf(descriptor);
    sessionKeySeconds = haxe.Timer.stamp() - started;
    final earlier = lastSessionKey;
    final state = earlier == null ? First : earlier == key ? Same : Changed;
    session = state;
    lastSessionKey = key;
    droppedRecords = KeptRecords.beginRequest(requestNumber, state != Same);
  }

  /**
   * Compares the metadata of every module with the earlier request, and
   * starts a new metadata epoch when a module that Haxe did not type again
   * has other metadata (genes-f8vc.9.27).
   *
   * Why: a macro of one module can change the metadata of a declaration of
   * another module that Haxe does not type again, for example in an
   * `onAfterTyping` callback. The passes after typing keep values that they
   * derived from metadata. Example (M2b of the review of genes-ts #246):
   * `SignatureCache` keeps the literal union `"dark" | "light"` of the enum
   * abstract `inc.Shade`, read from the `:value` metadata of the statics of
   * its implementation class before dead-code elimination removes them. A
   * macro writes `@:value("lighter")` on one of them; the class keeps its
   * stamp, so the keep rule would keep the old union, and the TypeScript of
   * every module that prints the type would be stale. After dead-code
   * elimination no fingerprint of the generation shadow can see those
   * statics. Checking each reader would not end, so this compares all
   * metadata of the program instead.
   *
   * What: the text of one module is the text that
   * `ModuleFingerprint.addDeclaration` gives each of its declarations: the
   * metadata of the declaration, of its fields, constructors, enum
   * constructors and type parameters, and of the structures of its declared
   * types. When a module has another digest of that text than in the
   * earlier request, each line that both requests have is compared
   * (`addMetadataLines`), except the lines of a declaration that arrived
   * without its stamp in this request: Haxe typed it again, and the keep
   * rule rejects its records anyway. The decision is made for each
   * declaration, not for the module (must fix 1 of the review of genes-ts
   * #249): Haxe can add a declaration to a module that it did not type
   * again, and the other declarations keep their records. When one compared
   * line differs, `metadataEpoch` grows.
   * The epoch is a line of the session key, so every record of every pass
   * is dropped and the generation cache does not use its stored output, in
   * this request only: the next request compares with this one.
   *
   * Limits:
   *
   * - Metadata that only a typed body holds (S3 of the review of genes-ts
   *   #246). The generation replay checks the type parameters of a local
   *   function and the structures of the declared type of a local variable
   *   or argument as recorded answers (genes-f8vc.9.27); the passes after
   *   typing keep no fact that depends on that metadata.
   * - Metadata added after this callback and before Haxe saves the class
   *   state, for example by an `onGenerate` macro or by
   *   `-D analyzer-optimize` (`@:pure(inferredPure)`): Haxe restores it in
   *   the next request, so the module looks changed once each time Haxe
   *   types it, and that request generates in full. Safe, only slower; see
   *   `ModuleFingerprint.BEFORE_DCE_EXCLUDED_META`. The post-DCE
   *   fingerprints of the generation shadow see such a change for every
   *   declaration that a printer can reach by name.
   * - Only the first declaration list of a request is compared. A later
   *   list holds the types that a callback defined in this request; Haxe
   *   gives them again in each request, so they arrive without a stamp, and
   *   a copied stamp is the case of the same-object test.
   * - A declaration that arrives without a stamp in every request (a class
   *   that Haxe first typed in a request that added no stamp, or one with
   *   a stamp that names another declaration) is never compared. Its own
   *   records are never kept, but a value that another declaration derived
   *   from its metadata is not guarded here.
   */
  static function compareMetadata(types: Array<ModuleType>,
      records: Array<Null<ClassType>>,
      parts: Array<Null<ModuleFingerprint.ClassParts>>,
      kept: Array<Bool>): Void {
    // The text of each declaration on its own, with its arrival: the module
    // text is their concatenation in Haxe's order.
    final texts = new Map<String, Array<{text: String, kept: Bool}>>();
    for (index => type in types) {
      final record = records[index];
      final base: BaseType = record != null ? record : DependencyPlan.moduleTypeBase(type);
      final buffer = new StringBuf();
      ModuleFingerprint.addDeclaration(buffer, type, record, parts[index]);
      final entry = {text: buffer.toString(), kept: kept[index]};
      final list = texts.get(base.module);
      if (list == null)
        texts.set(base.module, [entry]);
      else
        list.push(entry);
    }
    final changed = [];
    for (module => list in texts) {
      final digest = Context.signature([for (entry in list) entry.text].join(''));
      if (metadataDigests.get(module) == digest)
        continue;
      // Review of genes-ts #249 (must fix 1): "typed again" is decided for
      // each declaration, not for the module. Haxe can add a declaration to
      // a module that it did not type again (the wrapper class of an inline
      // method of an extern class that is used as a value); the other
      // declarations keep their stamps and their records, so their lines
      // are compared. Only the lines of a declaration that arrived without
      // its stamp are not.
      final lines = new Map<String, String>();
      final skipped = new Map<String, Bool>();
      for (entry in list)
        addMetadataLines(lines, entry.text, entry.kept ? null : skipped);
      final earlier = metadataLineDigests.get(module);
      if (earlier != null && changedLine(earlier, lines, skipped))
        changed.push(module);
      metadataDigests.set(module, digest);
      metadataLineDigests.set(module, lines);
    }
    changed.sort(compareStrings);
    metadataChangedModules = changed;
    if (changed.length > 0)
      metadataEpoch++;
  }

  /**
   * Adds to `lines` the digest of each line of one declaration's metadata
   * text (`ModuleFingerprint.addDeclaration`), by line key: the first two words
   * of a declaration line (`class inc.Shade._Shade_Impl_`), or those of a
   * field or constructor line after the key of its declaration
   * (`class inc.Shade._Shade_Impl_/static Light`).
   *
   * Why line by line: Haxe adds a static field to a class that it did not
   * type again when another module first uses a `@:generic` method of it.
   * That changes the member list (condition 6 of the keep rule rejects the
   * records of that class), not the metadata of any part that both requests
   * have, so it must not start a new metadata epoch.
   *
   * `skipped` is given for a declaration that arrived without its stamp:
   * each of its keys is added to it, and `changedLine` does not compare
   * them.
   */
  static function addMetadataLines(lines: Map<String, String>, text: String,
      skipped: Null<Map<String, Bool>>): Void {
    var declaration = '';
    for (line in text.split('\n')) {
      if (line.length == 0)
        continue;
      final inner = StringTools.startsWith(line, '  ');
      final words = StringTools.ltrim(line).split(' ');
      final head = words.length > 1 ? words[0] + ' ' + words[1] : words[0];
      if (!inner)
        declaration = head;
      final key = inner ? declaration + '/' + head : head;
      final digest = Context.signature(line);
      final known = lines.get(key);
      lines.set(key, known == null ? digest : known + digest);
      if (skipped != null)
        skipped.set(key, true);
    }
  }

  /**
   * Returns true when a line that both `earlier` and `now` have differs. A
   * line that only one of them has is a part that was added or removed.
   */
  static function changedLine(earlier: Map<String, String>,
      now: Map<String, String>, skipped: Map<String, Bool>): Bool {
    for (key => digest in now) {
      if (skipped.exists(key))
        continue;
      final before = earlier.get(key);
      if (before != null && before != digest)
        return true;
    }
    return false;
  }

  /**
   * Returns the sorted modules that Haxe did not type again and whose
   * metadata changed since the earlier request (`compareMetadata`). Empty
   * in most requests. When it is not empty, the session key changed.
   */
  public static function metadataChanged(): Array<String> {
    return metadataChangedModules;
  }

  /**
   * Reads the stamp of `base`, and adds a stamp of this request when the
   * declaration has no stamp that names it.
   *
   * A stamp that names another declaration, a second stamp, or an entry that
   * cannot be read is removed first. For a class that Haxe typed in this
   * request the new stamp is saved with the class. For a class that Haxe
   * kept, Haxe restores the old metadata in the next request, so that class
   * is rejected in every request: safe, but slow.
   */
  static function stamp(base: BaseType, key: String, currentNonce: String,
      pos: Position): StampedDeclaration {
    final entries = base.meta.extract(EPOCH_META);
    if (entries.length == 1) {
      switch entries[0].params {
        case [
          {expr: EConst(CString(stampNonce, _))},
          {expr: EConst(CInt(value, _))},
          {expr: EConst(CString(stampKey, _))}
        ] if (stampKey == key):
          return {
            key: key,
            module: base.module,
            stamp: '$stampNonce:$value',
            arrival: Kept
          };
        default:
      }
    }
    if (entries.length > 0)
      base.meta.remove(EPOCH_META);
    base.meta.add(EPOCH_META, [
      {expr: EConst(CString(currentNonce, DoubleQuotes)), pos: pos},
      {expr: EConst(CInt(Std.string(requestNumber))), pos: pos},
      {expr: EConst(CString(key, DoubleQuotes)), pos: pos}
    ], pos);
    return {
      key: key,
      module: base.module,
      stamp: '$currentNonce:$requestNumber',
      arrival: entries.length == 0 ? TypedAgain : ForeignStamp
    };
  }

  /**
   * Builds the session key (condition 2 of the keep rule): every input that
   * can change the result of a pass, or the output of a module, for a
   * declaration that Haxe did not type again.
   *
   * The output path enters only through `outputKeyLines`: the file name and
   * the way from the output folder to the project root, not the absolute
   * path. A development session writes each build to a new candidate folder,
   * and a key with the absolute path would drop every kept record and the
   * generation cache on each request.
   */
  static function sessionKeyOf(descriptor: IncrementalDescriptor): String {
    final buffer = new StringBuf();
    buffer.add('format $FORMAT\n');
    buffer.add('haxe ${Context.definedValue('haxe')}\n');
    buffer.add('program ${descriptor.programDigest}\n');
    buffer.add('cwd ${Path.normalize(Sys.getCwd())}\n');
    buffer.add('metadata-epoch $metadataEpoch\n');
    final output = genes.Generator.configuredOutput();
    // Without a captured output path (no `-js` when `Generator.use()` ran),
    // the key keeps Haxe's output slot as it is: safe, because any change of
    // it changes the key.
    buffer.add(output == null ? 'output-slot ${Compiler.getOutput()}\n' : outputKeyLines(output,
      genes.SourceMapGenerator.projectRoot()));
    final defines = defineLines();
    typingDefines = defines;
    buffer.add(defines);
    for (classPath in Context.getClassPath())
      buffer.add('classpath $classPath\n');
    // The output of `haxe.Resource` holds the resource bytes, and a changed
    // resource file makes Haxe type no module again.
    final resources = resourceDigest();
    typingResources = resources;
    buffer.add(resources);
    // Haxe may keep the macro interpreter, and so the records, when a Genes
    // source file changes in place. The status of each file under the Genes
    // class path makes such an edit change the key.
    final generator = try Context.resolvePath('genes/Generator.hx')
    catch (_:haxe.Exception) null;
    if (generator != null) {
      final root = Path.directory(Path.directory(FileSystem.absolutePath(generator)));
      addSourceStatus(buffer, root, '');
    }
    // The text itself is the key. A digest would cost more than the
    // comparison of two texts, because the macro interpreter computes it.
    return buffer.toString();
  }

  /**
   * Returns the two lines of the session key that stand for the output path:
   * the way from the output folder to the project root, and the name of the
   * output file with its extension.
   *
   * Why: a development session writes each build to a new candidate folder,
   * for example `.genes/dev/candidates/revision-3-ab/output/index.tsx` and
   * then `.genes/dev/candidates/revision-4-cd/output/index.tsx`. An absolute
   * path in the key would differ on every request, so every kept record and
   * the generation cache would be dropped each time (G2 design review,
   * required change 1). The output bytes depend on the output path only
   * through what these lines hold:
   *
   * - the file name and extension: the name of the root module, the
   *   extension of every module file and import, and the `file` field and
   *   `sourceMappingURL` of each source map;
   * - the way from the output folder to the project root: a source map names
   *   each source inside the project root by a path relative to the map
   *   (`SourceMapGenerator.sourceIdentities`). `projectRoot` is the root that
   *   source maps use (`-D genes.source_map_root`, else the working folder);
   *   both of those are in the key too. Sources outside the root get
   *   `haxe://classpath/...` names, which do not depend on the output path.
   *
   * Example, with the project root `/p`:
   *
   * - `/p/.genes/dev/candidates/revision-3-ab/output/index.tsx` gives
   *   `output-root ../../../../..` and `output-file index.tsx`. The sibling
   *   folder `revision-4-cd/output` gives the same lines, so the cache stays.
   * - `/p/out/index.tsx` gives `output-root ..`: another depth, other source
   *   map paths, so the key differs and the cache is dropped.
   * - `/p/out/index.ts` gives `output-file index.ts`: another extension.
   *
   * Boundary: two output folders with equal lines give equal source-map
   * paths for every source that is not inside the folder where the two paths
   * part (`revision-3-ab` or `revision-4-cd` above). The relative path of
   * such a source starts with the different folder name. The key does not
   * show that case, so the generation cache checks it itself: it stores the
   * absolute output folder and the sources that each stored map names by a
   * relative path, and a module with such a source inside either parting
   * folder is not clean (`GenerationCache.partingFolders`).
   *
   * How: `PathUtil.relative` is the function that source maps use. It is
   * asked for the way from the output file to a file of the same name in the
   * project root; the folder part of the answer is the way back to the root.
   *
   * Keep it in step with `SourceMapGenerator.sourceIdentities`: when source
   * maps name their sources from another folder (genes-f8vc.16 may make
   * them relative to the published location instead of the candidate
   * folder), these lines must describe that folder.
   */
  public static function outputKeyLines(output: String,
      projectRoot: String): String {
    final file = Path.withoutDirectory(output);
    final toRoot = Path.directory(genes.util.PathUtil.relative(output,
      Path.join([projectRoot, file])));
    return 'output-root $toRoot\noutput-file $file\n';
  }

  /**
   * Adds one line for each `.hx` file under `root/relative` to the session
   * key text: its path below `root`, its size and its modification time. The
   * entries of each folder are sorted, so the same tree gives the same text.
   *
   * Why: Haxe can keep the macro interpreter, and with it the kept records,
   * when a Genes source file changes in place. A record that an older Genes
   * wrote must not be kept; the changed line makes the session key differ.
   * Example line: `source genes/Generator.hx 41250 1763190000000`.
   */
  static function addSourceStatus(buffer: StringBuf, root: String,
      relative: String): Void {
    final directory = relative.length == 0 ? root : Path.join([root, relative]);
    final entries = FileSystem.readDirectory(directory);
    entries.sort(compareStrings);
    for (entry in entries) {
      final child = relative.length == 0 ? entry : relative + '/' + entry;
      final path = Path.join([root, child]);
      if (FileSystem.isDirectory(path)) {
        addSourceStatus(buffer, root, child);
      } else if (StringTools.endsWith(entry, '.hx')) {
        final status = FileSystem.stat(path);
        buffer.add('source $child ${status.size} ${status.mtime.getTime()}\n');
      }
    }
  }

  /**
   * Adds the names that `renameVars.ml` (`reserve_all_types`) reserves for one
   * declaration: its native name, or the first package name, or the type name
   * when there is no package. A class with an empty native name reserves its
   * statics, and a module-fields class reserves its flat field names.
   *
   * `record` is the class record that `observe` already read, or `null` for
   * another declaration kind.
   */
  static function reserveNames(type: ModuleType, base: BaseType,
      record: Null<ClassType>): Void {
    final native = nativeName(base.meta);
    final topLevel = base.pack.length > 0 ? base.pack[0] : base.name;
    if (record != null && native == '') {
      for (field in record.statics.get()) {
        final fieldNative = nativeName(field.meta);
        reservedNames.set(fieldNative != null ? fieldNative : field.name, true);
      }
      return;
    }
    if (record != null) {
      switch record.kind {
        case KModuleFields(module):
          final prefix = module.split('.').join('_') + '_';
          for (field in record.statics.get()) {
            final fieldNative = nativeName(field.meta);
            reservedNames.set(fieldNative != null ? fieldNative : prefix
              + field.name, true);
          }
          return;
        default:
      }
    }
    reservedNames.set(native != null ? native : topLevel, true);
  }

  /** Returns the text of `@:native("...")` in `meta`, or `null` without one. */
  static function nativeName(meta: MetaAccess): Null<String> {
    for (entry in meta.extract(':native')) {
      switch entry.params {
        case [{expr: EConst(CString(value, _))}]:
          return value;
        default:
      }
    }
    return null;
  }

  /**
   * Returns the name of this life of the macro interpreter: 16 hexadecimal
   * characters, made from the time and two random numbers at the first call
   * and kept in a `@:persistent` field.
   *
   * Why: a new macro interpreter counts requests from 1 again. Without the
   * name, a stamp of request 3 of an earlier interpreter would equal a stamp
   * of request 3 of this one, and a record could be kept for another object.
   */
  static function interpreterNonce(): String {
    final known = nonce;
    if (known != null)
      return known;
    final created = Sha256.encode(Std.string(Sys.time())
      + ':'
      + Std.string(Std.random(0x3FFFFFFF))
      + ':'
      + Std.string(Std.random(0x3FFFFFFF)))
      .substr(0, 16);
    nonce = created;
    return created;
  }

  static function compareStrings(left: String, right: String): Int {
    return left < right ? -1 : left > right ? 1 : 0;
  }
}
#end
