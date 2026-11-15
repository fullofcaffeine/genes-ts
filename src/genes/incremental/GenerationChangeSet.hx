package genes.incremental;

#if macro
import genes.DependencyPlan;
import genes.incremental.IncrementalRequest.AfterTypingReuse;
import genes.incremental.IncrementalRequest.IncrementalDescriptor;
import genes.incremental.KeptRecords.KeptRecordsReport;
import haxe.crypto.Sha256;
import haxe.io.Path;
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

/** A class of this request: the record that the walk reads, and its stamp. */
typedef ObservedClass = {
  final type: ClassType;

  /** `null` when the request left the incremental path (an `@:rtti` class). */
  final stamp: Null<StampedDeclaration>;
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

  /** Time to compute the session key. */
  final sessionKeyMs: Float;

  /** Time to read the member list of each class. */
  final memberListMs: Float;

  /** Time of the class walk and the declaration functions of all passes. */
  final walkMs: Float;

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
 *    text of the inputs that change what a pass computes but not always
 *    what Haxe types: the format, the Haxe version, every define at the first
 *    after-typing callback, the session's digest of the argument list, the
 *    class paths in order, the working folder, and the status of each `.hx`
 *    file under the Genes class path. When it differs, every record of every
 *    pass is dropped.
 * 3. The declaration arrived with one stamp, and the stamp names it.
 * 4. That stamp equals the stamp in the record, and the same pass wrote the
 *    record (each pass has its own `KeptRecords`).
 * 5. The record's typed values address the declaration object of this
 *    request (the same-object test). This test needs a kept reference to the
 *    declaration: it writes one metadata entry through the old reference and
 *    reads it through the new one. The records of this owner are plain text
 *    and hold no typed compiler value, so no record here can be tested that
 *    way, and no such value can be stale. The probe
 *    `tests/compiler-server/probes/KeptTypeValuesProbe.hx` runs the test on
 *    its own kept values. A pass that will keep typed values must add this
 *    test before it reads them.
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
 * Lifetime: only the nonce, the request counter and the last session key are
 * `@:persistent`. They are plain text and numbers. Every other field is an
 * ordinary static that Haxe replaces at the start of each compilation; the
 * declaration map holds no compiler value. Without
 * `-D genes.dev_incremental` nothing here runs.
 */
class GenerationChangeSet {
  /** The metadata name of the stamp. */
  public static inline final EPOCH_META = ':genes.typedEpoch';

  /** The format of the kept records and of the report. */
  public static inline final FORMAT = 1;

  static inline final MODULE_LIMIT = 100;

  @:persistent static var nonce: Null<String> = null;
  @:persistent static var requestCounter = 0;
  @:persistent static var lastSessionKey: Null<String> = null;

  static var requestNumber = 0;
  static var session: Null<SessionState> = null;
  static var droppedRecords = 0;
  static var declarations = 0;
  static var classes = 0;
  static var typedAgain = 0;
  static var arrivedStamped = 0;
  static var foreignStamps = 0;
  static var typedAgainModules: Map<String, Bool> = new Map();
  static var stampSeconds = 0.0;
  static var sessionKeySeconds = 0.0;
  static var memberSeconds = 0.0;
  static var walkSeconds = 0.0;
  static var complete = false;
  static var reportWarned = false;

  /**
   * Stamps one declaration list that Haxe gave to `onAfterTyping` and
   * returns, for each class in it, the class record and its stamp. The array
   * has one entry for each entry of `types`; an entry that is not a class is
   * `null`.
   *
   * Returns `null` when the request does not use the incremental path. Then
   * nothing was read and nothing was added.
   *
   * Haxe may call the callback again in one request, when a callback defines
   * new types; those declarations are new, so they arrive without a stamp.
   */
  public static function observe(types: Array<ModuleType>): Null<Array<Null<ObservedClass>>> {
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
      return [
        for (record in records)
          record == null ? null : {type: record, stamp: null}
      ];
    }
    var keySeconds = 0.0;
    if (requestNumber == 0) {
      beginRequest(descriptor);
      keySeconds = sessionKeySeconds;
    }
    final currentNonce = interpreterNonce();
    final pos = Context.currentPos();
    final observed: Array<Null<ObservedClass>> = [];
    for (index => type in types) {
      final record = records[index];
      final base: BaseType = record != null ? record : DependencyPlan.moduleTypeBase(type);
      final stamped = stamp(base, DependencyPlan.moduleTypeKeyOf(type, base),
        currentNonce, pos);
      declarations++;
      switch stamped.arrival {
        case Kept:
          arrivedStamped++;
        case TypedAgain:
          typedAgain++;
          typedAgainModules.set(base.module, true);
        case ForeignStamp:
          foreignStamps++;
          typedAgainModules.set(base.module, true);
      }
      if (record != null) {
        classes++;
        observed.push({type: record, stamp: stamped});
      } else {
        observed.push(null);
      }
    }
    stampSeconds += haxe.Timer.stamp() - started - keySeconds;
    writeReport();
    return observed;
  }

  /**
   * Decides whether a record of an earlier request is still valid for
   * `declaration` (conditions 3, 4 and 6 of the keep rule; see the class
   * comment for 1, 2 and 5).
   *
   * `recordStamp` and `recordMembers` come from the record of the calling
   * pass; pass `null` for both when the pass has no record. `members` returns
   * the member list of the class now, or `null` for a declaration that is not
   * a class. It is called only when the stamps agree.
   */
  public static function keep(declaration: StampedDeclaration,
      recordStamp: Null<String>, recordMembers: Null<String>,
      members: Void->Null<String>): KeepDecision {
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
    if (recordMembers != members())
      return Reject(MembersChanged);
    return Keep;
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
   * Starts the request: takes the next request number, computes the session
   * key once, and drops every record when the key is not the one of the
   * earlier request.
   */
  static function beginRequest(descriptor: IncrementalDescriptor): Void {
    requestCounter++;
    requestNumber = requestCounter;
    final started = haxe.Timer.stamp();
    final key = sessionKeyOf(descriptor);
    sessionKeySeconds = haxe.Timer.stamp() - started;
    final earlier = lastSessionKey;
    final state = earlier == null ? First : earlier == key ? Same : Changed;
    session = state;
    lastSessionKey = key;
    droppedRecords = KeptRecords.beginRequest(requestNumber, state != Same);
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
   * can change the result of a pass for a declaration that Haxe did not type
   * again.
   */
  static function sessionKeyOf(descriptor: IncrementalDescriptor): String {
    final buffer = new StringBuf();
    buffer.add('format $FORMAT\n');
    buffer.add('haxe ${Context.definedValue('haxe')}\n');
    buffer.add('program ${descriptor.programDigest}\n');
    buffer.add('cwd ${Path.normalize(Sys.getCwd())}\n');
    final defines = Context.getDefines();
    final names = [for (name in defines.keys()) name];
    names.sort(compareStrings);
    for (name in names)
      buffer.add('define $name=${defines.get(name)}\n');
    for (classPath in Context.getClassPath())
      buffer.add('classpath $classPath\n');
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
