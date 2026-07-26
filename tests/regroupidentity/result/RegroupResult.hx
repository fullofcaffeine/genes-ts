package tests.regroupidentity.result;

/**
 * Three-parameter companion used to prove full generic argument preservation.
 *
 * This is deliberately unrelated to `tink.streams.RegroupResult`. Sharing a
 * simple name must not grant a type a compiler compatibility exception.
 */
class RegroupResult<Input, Output, Quality> {
  public final input:Input;
  public final output:Output;
  public final quality:Quality;

  public function new(input:Input, output:Output, quality:Quality) {
    this.input = input;
    this.output = output;
    this.quality = quality;
  }
}
