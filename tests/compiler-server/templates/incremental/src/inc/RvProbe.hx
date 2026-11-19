package inc;

/**
 * Review probes 6a to 6e of slice S2 (genes-f8vc.9.19): calls each probe
 * root so that dead-code elimination keeps it. `RvExtInit` is an extern
 * class with `__init__`: Genes warns about it with
 * `-D genes.extern_init_warning`, once per request.
 */
class RvProbe {
  public static function run(): String {
    return RvHold.value() + RvEndA.run() + RvEndB.run() + RvOrd.value()
      + RvOrdEndX.run() + RvOrdEndY.run() + new RvCyP().name()
      + RvBoxUser.run() + RvName.value() + RvNameEnd.run()
      + RvExtInit.keys({}).length;
  }
}
