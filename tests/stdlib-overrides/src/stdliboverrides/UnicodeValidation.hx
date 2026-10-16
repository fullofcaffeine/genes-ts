package stdliboverrides;

import haxe.io.Bytes;
import haxe.io.Encoding;

/** Independent byte fixtures exercise the standard validator before decoding. */
final class UnicodeValidation {
  public static function verify(): Void {
    for (hex in [
      "",
      "00",
      "7f",
      "c280",
      "dfbf",
      "e0a080",
      "ed9fbf",
      "ee8080",
      "efbfbf",
      "f0908080",
      "f48fbfbf",
      "61c3a9e4b8adf09f9880"
    ]) {
      if (!UnicodeString.validate(Bytes.ofHex(hex), Encoding.UTF8))
        throw "Rejected valid UTF-8: " + hex;
    }
    for (hex in [
      "80",
      "bf",
      "c080",
      "c1bf",
      "c2",
      "c27f",
      "c2c0",
      "e0",
      "e0a0",
      "e08080",
      "e09fbf",
      "e0a07f",
      "eda080",
      "edbfbf",
      "f0",
      "f090",
      "f09080",
      "f0808080",
      "f08fbfbf",
      "f4908080",
      "f5808080",
      "ff",
      "e228a1",
      "f090c080",
      "f09080c0",
      "61ff62"
    ]) {
      if (UnicodeString.validate(Bytes.ofHex(hex), Encoding.UTF8))
        throw "Accepted malformed UTF-8: " + hex;
    }
    if (!UnicodeString.validate(Bytes.ofString("café λ 中文 😀"), Encoding.UTF8))
      throw "Rejected encoded Unicode text";
    var rawRejected = false;
    try {
      UnicodeString.validate(Bytes.ofString("a"), Encoding.RawNative);
    } catch (error:haxe.Exception) {
      rawRejected = error.message == "UnicodeString.validate: RawNative encoding is not supported";
    }
    if (!rawRejected)
      throw "RawNative must remain unsupported";
    final text: UnicodeString = "a😀é";
    if (text.length != 3 || text.charAt(1) != "😀"
      || text.substr(1, 2) != "😀é")
      throw "UnicodeString character operations changed";
  }
}
