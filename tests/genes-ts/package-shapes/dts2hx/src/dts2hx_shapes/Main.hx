package dts2hx_shapes;

import genes_dts2hx_esm_fixture.FeatureModule;
import genes_dts2hx_esm_fixture.Formatter;

/** Runtime values shared by the TypeScript-source and classic-JavaScript profiles. */
typedef Dts2hxBridgeTranscript = {
  final esmVersion: String;
  final formatted: String;
  final featureName: String;
  final featureScore: Float;
  final subpathName: String;
  final cjsVersion: String;
  final cjsLabel: String;
  final cjsClosed: String;
}

/**
 * Exercises dts2hx-generated externs without project-specific adapters.
 *
 * Why: declaration ingestion only belongs in the genes-ts ecosystem story if
 * one generated Haxe surface can drive both strict TypeScript source and
 * classic ESM JavaScript. This fixture keeps the boundary package-shaped and
 * deliberately avoids `Dynamic`, casts, and handwritten replacement externs.
 *
 * What: the root ESM entry, an ESM subpath, a conditional export map, and a
 * CommonJS `export =` constructor are all used in value and public type
 * positions.
 *
 * How: dts2hx creates the extern class path consumed here before either Haxe
 * profile runs. The package-shape harness then installs the same local runtime
 * packages beside each output and compares their typed runtime transcripts.
 */
class Main {
  public final formatter: Formatter;
  public final driver: GenesDts2hxCjsFixture;

  public function new(label: String) {
    formatter = new Formatter("genes");
    driver = new GenesDts2hxCjsFixture(label);
  }

  public function transcript(): Dts2hxBridgeTranscript {
    final rootFeature = formatter.feature("root");
    final subpathFeature = FeatureModule.createFeature("subpath");
    return {
      esmVersion: GenesDts2hxEsmFixture.version,
      formatted: formatter.format("bridge"),
      featureName: rootFeature.name,
      featureScore: rootFeature.score,
      subpathName: subpathFeature.name,
      cjsVersion: GenesDts2hxCjsFixture.version,
      cjsLabel: driver.label,
      cjsClosed: driver.close()
    };
  }

  public static function main(): Void {
    js.Node.console.log(haxe.Json.stringify(new Main("genes").transcript()));
  }
}
