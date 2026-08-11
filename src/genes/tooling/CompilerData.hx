package genes.tooling;

#if macro
import haxe.crypto.Base64;
import haxe.io.Bytes;
import haxe.macro.Context;
import sys.FileSystem;
import sys.io.File;

/*
 * This module gives trusted Haxe macros one narrow way to return bytes to a
 * DevelopmentSession. It exists only in macro code and adds no runtime API.
 * Module-level functions match the JavaScript module shape because no class
 * identity or object instance is part of this contract.
 */
private typedef CompilerDataSlot = {
  final id: String;
  final maxBytes: Int;
  final path: String;
}

private final DESCRIPTOR_DEFINE = "genes.tooling.compiler-data";

// The line format keeps this macro boundary fully typed. A JSON parser would
// first return Dynamic data, although this request has only three exact fields.
private final DESCRIPTOR_HEADER = "genes.tooling.compiler-data-request-v1";

/**
 * Writes UTF-8 text to one private compiler-data slot for the current build.
 *
 * Why: a host can need data that a macro derives while Haxe checks the source.
 * The data stays beside the private candidate until the host validates it.
 *
 * How: DevelopmentSession declares each allowed ID before compilation. This
 * function reads that request's descriptor and writes only the matching slot.
 * It does not return a path or publish a file.
 */
function writeUtf8(id: String, content: String): Void {
  writeBytes(id, Bytes.ofString(content));
}

/**
 * Writes bytes to one declared private slot for the current Haxe request.
 *
 * The slot can be written once. The session independently checks the complete
 * private directory, exact byte size, links, and file stability after Haxe
 * exits. This helper gives an earlier, friendlier compiler error.
 */
function writeBytes(id: String, content: Bytes): Void {
  final slot = findSlot(id);
  if (content.length > slot.maxBytes) {
    fail('compiler data ${id} exceeds its byte limit');
  }
  if (FileSystem.exists(slot.path)) {
    fail('compiler data ${id} was written more than once');
  }
  try {
    File.saveBytes(slot.path, content);
  } catch (_:haxe.Exception) {
    fail('compiler data ${id} could not be written');
  }
}

private function findSlot(id: String): CompilerDataSlot {
  if (id.length == 0) {
    fail("compiler data id must not be empty");
  }
  final descriptorPath = Context.definedValue(DESCRIPTOR_DEFINE);
  if (descriptorPath == null || descriptorPath.length == 0) {
    fail("compiler data requires a DevelopmentSession declaration");
  }
  final descriptor = try {
    File.getContent(descriptorPath);
  } catch (_:haxe.Exception) {
    fail("compiler data request is unavailable");
  }
  final lines = descriptor.split("\n");
  if (lines.length == 0 || lines[0] != DESCRIPTOR_HEADER) {
    fail("compiler data request has an unsupported format");
  }
  for (index in 1...lines.length) {
    final line = lines[index];
    if (line.length == 0)
      continue;
    final fields = line.split("\t");
    if (fields.length != 3) {
      fail("compiler data request is malformed");
    }
    final slotId = decode(fields[0]);
    final maxBytes = Std.parseInt(fields[1]);
    final slotPath = decode(fields[2]);
    if (maxBytes == null || maxBytes <= 0 || slotPath.length == 0) {
      fail("compiler data request is malformed");
    }
    if (slotId == id) {
      return {id: slotId, maxBytes: maxBytes, path: slotPath};
    }
  }
  return fail('compiler data id is not declared: ${id}');
}

private function decode(value: String): String {
  try {
    return Base64.decode(value).toString();
  } catch (_:haxe.Exception) {
    return fail("compiler data request is malformed");
  }
}

private function fail<T>(message: String): T {
  // Haxe types `Context.fatalError` as Dynamic because it never returns. Keep
  // that compiler API escape inside this one generic failure boundary.
  return Context.fatalError(message, Context.currentPos());
}
#end
