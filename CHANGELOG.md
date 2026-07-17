## [1.35.3](https://github.com/fullofcaffeine/genes-ts/compare/v1.35.2...v1.35.3) (2026-07-17)


### Bug Fixes

* **ts2hx:** retire stale manifest-owned output ([3f7b16f](https://github.com/fullofcaffeine/genes-ts/commit/3f7b16f4e9764c643018653f3c5d0e62815c589e))

## [1.35.2](https://github.com/fullofcaffeine/genes-ts/compare/v1.35.1...v1.35.2) (2026-07-17)


### Bug Fixes

* **ts2hx:** coordinate diagnostics publication ([face6ea](https://github.com/fullofcaffeine/genes-ts/commit/face6ead9bfa23a343c140f7d627b800199bfb61))

## [1.35.1](https://github.com/fullofcaffeine/genes-ts/compare/v1.35.0...v1.35.1) (2026-07-17)


### Bug Fixes

* **imports:** reject malformed import attributes ([f2db60b](https://github.com/fullofcaffeine/genes-ts/commit/f2db60be0161d4511b7a5a2705ecc8e0cbe2c9c2))

# [1.35.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.34.2...v1.35.0) (2026-07-17)


### Bug Fixes

* **template:** preserve compound interpolation slots ([b6c0463](https://github.com/fullofcaffeine/genes-ts/commit/b6c0463fa626b7dc5debec6f5fc9013d4f0c9775))


### Features

* **ts:** preserve typed template literals ([dae8194](https://github.com/fullofcaffeine/genes-ts/commit/dae8194402672c67f3f56ff5a1d9f27a79539ba1))

## [1.34.2](https://github.com/fullofcaffeine/genes-ts/compare/v1.34.1...v1.34.2) (2026-07-17)


### Bug Fixes

* **ts2hx:** validate source namespace identity ([2b4b71b](https://github.com/fullofcaffeine/genes-ts/commit/2b4b71b00528fb376f7f0f8527237cf336b0f36b))

## [1.34.1](https://github.com/fullofcaffeine/genes-ts/compare/v1.34.0...v1.34.1) (2026-07-17)


### Bug Fixes

* **output:** isolate transaction owner identities ([a44ee09](https://github.com/fullofcaffeine/genes-ts/commit/a44ee09cb44d8d6d29b1e7ff8d45f49386d6d715))
* **output:** remove visible trailing whitespace ([0fd8540](https://github.com/fullofcaffeine/genes-ts/commit/0fd854046b05c0094cd519b19aa259184c8ea57c))

# [1.34.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.33.1...v1.34.0) (2026-07-17)


### Features

* **generator:** support module directive prologues ([#1](https://github.com/fullofcaffeine/genes-ts/issues/1)) ([9b33a04](https://github.com/fullofcaffeine/genes-ts/commit/9b33a048769373c57bfc066160641badc5bf93ed))

## [1.33.1](https://github.com/fullofcaffeine/genes-ts/compare/v1.33.0...v1.33.1) (2026-07-17)


### Bug Fixes

* **output:** preserve unowned legacy source maps ([8989465](https://github.com/fullofcaffeine/genes-ts/commit/89894654f61a86d882b55306e5ec726b27a337a8))

# [1.33.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.32.0...v1.33.0) (2026-07-16)


### Features

* **ts2hx:** support typed package bindings ([929ea93](https://github.com/fullofcaffeine/genes-ts/commit/929ea93d9dbeb57098d9ffdc301fce524bcccfa8))

# [1.32.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.31.0...v1.32.0) (2026-07-16)


### Features

* **ts2hx:** carry loop control through finally ([f4e0413](https://github.com/fullofcaffeine/genes-ts/commit/f4e0413471cb59925d2b88f920731d331dd498d4))
* **ts2hx:** promote finally outer completion ([c5b2a62](https://github.com/fullofcaffeine/genes-ts/commit/c5b2a629c665106f093eb587505db8fe15d3dd54))

# [1.31.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.30.0...v1.31.0) (2026-07-16)


### Features

* **ts2hx:** carry typed returns through finally ([d9fb1f8](https://github.com/fullofcaffeine/genes-ts/commit/d9fb1f8b11155146c5b113f87955b33777a0a9b5))

# [1.30.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.29.0...v1.30.0) (2026-07-16)


### Features

* **runtime:** add typed finally completion runner ([979df20](https://github.com/fullofcaffeine/genes-ts/commit/979df209069822fb59c779ba1c5c09c65da5b63d))

# [1.29.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.28.0...v1.29.0) (2026-07-16)


### Features

* **codegen:** contain compiler-internal types ([0a6522b](https://github.com/fullofcaffeine/genes-ts/commit/0a6522bc76d3b19c064d4e49ecdf15f321971164))

# [1.28.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.27.0...v1.28.0) (2026-07-16)


### Bug Fixes

* **dts:** keep declaration names out of type fallbacks ([f48a631](https://github.com/fullofcaffeine/genes-ts/commit/f48a63141b8e137369becc64e3ba0cc6916de126))
* **dts:** preserve constructor-local enum generics ([f12077d](https://github.com/fullofcaffeine/genes-ts/commit/f12077d06abfa0fb39357ee99728758141e427d4))
* **dts:** type nullary generic enums with never ([c2ec7ad](https://github.com/fullofcaffeine/genes-ts/commit/c2ec7ad4a43af9528171cb417546e96db5538a90))


### Features

* **ts2hx:** publish ESM request contract ([8d5813c](https://github.com/fullofcaffeine/genes-ts/commit/8d5813c013391ea5ed4a949e906d8a3e9e1155cc))

# [1.27.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.26.0...v1.27.0) (2026-07-16)


### Features

* **ts2hx:** order bound ESM runtime requests ([24851a9](https://github.com/fullofcaffeine/genes-ts/commit/24851a9db9918ddf503e0d1bd7855fa6239f2f6a))
* **ts2hx:** preserve bound ESM request order ([2f32ba3](https://github.com/fullofcaffeine/genes-ts/commit/2f32ba340ed57f90912590bf8b9c995343786557))

# [1.26.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.25.1...v1.26.0) (2026-07-16)


### Features

* **ts2hx:** require explicit ESM runtime profile ([2430567](https://github.com/fullofcaffeine/genes-ts/commit/24305673967379261af93520bbc705a92bddf260))

## [1.25.1](https://github.com/fullofcaffeine/genes-ts/compare/v1.25.0...v1.25.1) (2026-07-16)


### Bug Fixes

* preserve transitive runtime import order ([80f85d1](https://github.com/fullofcaffeine/genes-ts/commit/80f85d1c33bbfb1daa5eea099acc08de8f821506))

# [1.25.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.24.0...v1.25.0) (2026-07-15)


### Features

* lower converted side-effect imports ([1f3bf35](https://github.com/fullofcaffeine/genes-ts/commit/1f3bf35ed63c18428f3ddcc15cbf3b94773f116a))

# [1.24.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.23.0...v1.24.0) (2026-07-15)


### Features

* lower external ts2hx side-effect imports ([8a92f1a](https://github.com/fullofcaffeine/genes-ts/commit/8a92f1a49a297e1577aa80a14090795477197fcd))

# [1.23.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.22.0...v1.23.0) (2026-07-15)


### Features

* add side-effect import helpers ([a1125d1](https://github.com/fullofcaffeine/genes-ts/commit/a1125d19a5f4ac7bc7d418c9df412e5a4b9b3c2a))

# [1.22.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.21.0...v1.22.0) (2026-07-15)


### Features

* order runtime module requests ([749e7f7](https://github.com/fullofcaffeine/genes-ts/commit/749e7f7aeb8072a10b53457a8b647ba4b4254b9a))

# [1.21.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.20.2...v1.21.0) (2026-07-15)


### Features

* **ts2hx:** preserve switch continue transfers ([becfc4a](https://github.com/fullofcaffeine/genes-ts/commit/becfc4ab38790ec1f2f2474cbe41931d53a8d327))
* **ts2hx:** preserve unary plus coercion ([07d513c](https://github.com/fullofcaffeine/genes-ts/commit/07d513c83d08284e5228f82c7d0677449ae2ace3))

## [1.20.2](https://github.com/fullofcaffeine/genes-ts/compare/v1.20.1...v1.20.2) (2026-07-15)


### Bug Fixes

* preserve raw syntax receiver precedence ([52b7915](https://github.com/fullofcaffeine/genes-ts/commit/52b79154f317cab5fb706cdf8037b6b2c9cb8039))

## [1.20.1](https://github.com/fullofcaffeine/genes-ts/compare/v1.20.0...v1.20.1) (2026-07-15)


### Bug Fixes

* keep classic declarations self-contained ([11db3f9](https://github.com/fullofcaffeine/genes-ts/commit/11db3f925435eb16dbb08c8b3f029caf4c87edc3))
* preserve classic ESM import attributes ([41d84dd](https://github.com/fullofcaffeine/genes-ts/commit/41d84ddf79928d98c578e6fb97fdee48c0b8f27f))

# [1.20.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.19.0...v1.20.0) (2026-07-15)


### Features

* publish compiler output transactionally ([bc56934](https://github.com/fullofcaffeine/genes-ts/commit/bc56934e37fa9b389f5eb25f85faeac28923d7ad))

# [1.19.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.18.1...v1.19.0) (2026-07-15)


### Features

* **library:** retain matched public surfaces ([0d4001a](https://github.com/fullofcaffeine/genes-ts/commit/0d4001ac1604c0fb8439a02dae7c472ecd2b6ce7))

## [1.18.1](https://github.com/fullofcaffeine/genes-ts/compare/v1.18.0...v1.18.1) (2026-07-15)


### Bug Fixes

* **imports:** keep native globals independent ([286f2e3](https://github.com/fullofcaffeine/genes-ts/commit/286f2e3bfa2b07287a1072dc7cb102ee112e9556))

# [1.18.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.17.0...v1.18.0) (2026-07-15)


### Features

* **qa:** publish compatibility evidence contracts ([a2fc754](https://github.com/fullofcaffeine/genes-ts/commit/a2fc75404ec8be405f1315ddafa9d7ea5486c9be))

# [1.17.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.16.0...v1.17.0) (2026-07-15)


### Features

* **interop:** add deterministic dts2hx bridge ([2ca8f3e](https://github.com/fullofcaffeine/genes-ts/commit/2ca8f3e023fa07265071dcb1c77787215cc89516))

# [1.16.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.15.0...v1.16.0) (2026-07-15)


### Features

* **ts2hx:** add semantic IR and differential matrix ([efa981a](https://github.com/fullofcaffeine/genes-ts/commit/efa981a9737d03f25078c52dbcb9745358aa403e))

# [1.15.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.14.1...v1.15.0) (2026-07-15)


### Features

* prove examples across TS and classic JS ([c3462c5](https://github.com/fullofcaffeine/genes-ts/commit/c3462c50cc30209c097dfaba5531097c971d8a65))

## [1.14.1](https://github.com/fullofcaffeine/genes-ts/compare/v1.14.0...v1.14.1) (2026-07-15)


### Bug Fixes

* type CommonJS export-equals constructor instances ([63244d1](https://github.com/fullofcaffeine/genes-ts/commit/63244d18cfacc607f1f6bc364f638185b9da0b0f))

# [1.14.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.13.2...v1.14.0) (2026-07-15)


### Features

* share JSX intent across TS and classic JS ([759dbf3](https://github.com/fullofcaffeine/genes-ts/commit/759dbf35ddbd20eee54fc685e1adc2589bf6eacd))

## [1.13.2](https://github.com/fullofcaffeine/genes-ts/compare/v1.13.1...v1.13.2) (2026-07-15)


### Bug Fixes

* **ts2hx:** fail closed on unsupported source ([154c980](https://github.com/fullofcaffeine/genes-ts/commit/154c980da26d9e11515594a8ccb7c3089fcaf917))

## [1.13.1](https://github.com/fullofcaffeine/genes-ts/compare/v1.13.0...v1.13.1) (2026-07-15)


### Bug Fixes

* close critical compiler type-safety gaps ([ca97d4e](https://github.com/fullofcaffeine/genes-ts/commit/ca97d4e93a8679a65df2c18ca789abbf3748ce89))

# [1.13.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.12.0...v1.13.0) (2026-06-28)


### Features

* **ts:** add typed JSON value helpers ([856bc00](https://github.com/fullofcaffeine/genes-ts/commit/856bc007e28f68550c8256313fcc8d4867a7b2f1))

# [1.12.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.11.0...v1.12.0) (2026-06-23)


### Bug Fixes

* **ci:** restore full genes gate ([5236989](https://github.com/fullofcaffeine/genes-ts/commit/5236989aa6f5acaa6a6d879a2aa1d01f37245ae8))
* **genes-ts:** parenthesize raw template receivers ([5254f9f](https://github.com/fullofcaffeine/genes-ts/commit/5254f9fc4b405824b8cf406b0201687e0c21e7cd))
* **ts:** avoid inline local name collisions ([8acd106](https://github.com/fullofcaffeine/genes-ts/commit/8acd1061fb633ea99a2c78c0267cbec436bef6ff))
* **ts:** elide null-guarded local casts ([b96af41](https://github.com/fullofcaffeine/genes-ts/commit/b96af41741e6ea2b0e36c5a50005e38af4aebeb3))
* **ts:** emit block-scoped locals without js-es ([b863b7b](https://github.com/fullofcaffeine/genes-ts/commit/b863b7b1b31587c656a9ac030f533c18910eaa27))
* **ts:** honor native anonymous fields ([72fe8de](https://github.com/fullofcaffeine/genes-ts/commit/72fe8de0ced809cc07f5f9954bae2185697a7c68))
* **ts:** limit block scoping to switch cases ([08c6623](https://github.com/fullofcaffeine/genes-ts/commit/08c6623983ce333254e19e2917bc5da82173696f))
* **ts:** narrow optional fields after null guards ([9e5c3a4](https://github.com/fullofcaffeine/genes-ts/commit/9e5c3a4d79d48581d09d8acfe62ac23c403fd3ff))
* **ts:** narrow optional fields through boolean conditions ([bed8060](https://github.com/fullofcaffeine/genes-ts/commit/bed806092d198f075a62d7da52f1d90b53feb860))
* **ts:** normalize optional fields for nullable params ([a5b4802](https://github.com/fullofcaffeine/genes-ts/commit/a5b4802ebb38cc25b469bdd92f953799aeaa0786))
* **ts:** parenthesize nullish null comparisons ([ab86227](https://github.com/fullofcaffeine/genes-ts/commit/ab862272e1813d44393fa5e8bc059a8fb7d67298))
* **ts:** preserve closed enum abstract unions ([ea54cb1](https://github.com/fullofcaffeine/genes-ts/commit/ea54cb1251877e2f408a56cbfc9d2d4598e526ae))
* **ts:** preserve narrowed locals from nullable branches ([63d3a42](https://github.com/fullofcaffeine/genes-ts/commit/63d3a42575b222981cc6d1b028e597501d53ff17))
* **ts:** preserve native fields in syntax templates ([909b9cf](https://github.com/fullofcaffeine/genes-ts/commit/909b9cfae0c8bf917cd93e5644d22c48718a3c51))
* **ts:** preserve nested optional field emission ([e93a7fa](https://github.com/fullofcaffeine/genes-ts/commit/e93a7fa32b56b1bee21bb8fa4d1bbec4be7a315f))
* **ts:** preserve raw placeholder call context ([230bbec](https://github.com/fullofcaffeine/genes-ts/commit/230bbecbdd9717e509bc91984bd6b21d179f6ff1))
* **ts:** preserve undefinable assignment output ([dacd5f8](https://github.com/fullofcaffeine/genes-ts/commit/dacd5f8572adad6c0f194549795ac5be04ffa4b5))
* **ts:** preserve undefinable object fields ([81d622d](https://github.com/fullofcaffeine/genes-ts/commit/81d622d5e260d084f288e38cdbc345d41cbebb81))
* **ts:** propagate array element context ([0e722e4](https://github.com/fullofcaffeine/genes-ts/commit/0e722e4ad5cf86a35e81813d8d92eddd20932ad3))
* **ts:** propagate call argument object context ([5b93d28](https://github.com/fullofcaffeine/genes-ts/commit/5b93d285bbf3325c5647c16863af02c7e7fd1c45))
* **ts:** propagate ternary expected types ([e6a9d8c](https://github.com/fullofcaffeine/genes-ts/commit/e6a9d8c23b3ed3e415b924aef96173acbc413e61))
* **ts:** scope enum switch case locals ([4d8c2f9](https://github.com/fullofcaffeine/genes-ts/commit/4d8c2f95f471bb739c5e32d0ada2f927d9dbdf52))
* **ts:** trust narrowed call arguments ([3b5850e](https://github.com/fullofcaffeine/genes-ts/commit/3b5850e1fe0faf7af9c5fef2ce792b4a3b3f232c))
* **ts:** use abstract object field context ([5c4adb1](https://github.com/fullofcaffeine/genes-ts/commit/5c4adb14cb397e43eec5eeeba650a94d01ae73fa))
* type lowered catch temps without any ([e0a30ce](https://github.com/fullofcaffeine/genes-ts/commit/e0a30ce6dbc519babf5236931b7e20faad86e6a0))


### Features

* **ts:** add resource import helpers for text, file, and dynamic WASM assets
* **ts:** add unknown narrowing primitives ([ed61fe7](https://github.com/fullofcaffeine/genes-ts/commit/ed61fe76afeaa49f6fb46e3d1a0319cfe9514400))

# [1.11.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.10.0...v1.11.0) (2026-02-05)


### Features

* **todoapp:** one-command build+run ([d7fb0ec](https://github.com/fullofcaffeine/genes-ts/commit/d7fb0ec08f3fd2e534a110c0858b5b60ab660e70))

# [1.10.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.9.0...v1.10.0) (2026-02-01)


### Features

* **ts2hx:** minimal TSX lowering ([f5a21e9](https://github.com/fullofcaffeine/genes-ts/commit/f5a21e96b6e909efa34c9b8afcdf296e791561de))

# [1.9.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.8.0...v1.9.0) (2026-02-01)


### Features

* **ts2hx:** async/await support ([5c2287f](https://github.com/fullofcaffeine/genes-ts/commit/5c2287fa6513730f02bd0339ce2e68ff5811227e))

# [1.8.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.7.0...v1.8.0) (2026-02-01)


### Features

* **ts2hx:** optional chaining + logical assigns ([47be458](https://github.com/fullofcaffeine/genes-ts/commit/47be45814adb282ede4c20ef1d310fb4b85b319a))

# [1.7.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.6.0...v1.7.0) (2026-02-01)


### Features

* **ts2hx:** default + rest params ([6fe42a0](https://github.com/fullofcaffeine/genes-ts/commit/6fe42a0635f652e6aae0c56507bfe0f66a26fa22))

# [1.6.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.5.0...v1.6.0) (2026-02-01)


### Features

* **ts2hx:** destructuring patterns ([4c4c072](https://github.com/fullofcaffeine/genes-ts/commit/4c4c07202a0d25f798fc917807510320e11a9e1c))

# [1.5.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.4.0...v1.5.0) (2026-02-01)


### Features

* **ts2hx:** improved type emission ([5da5ac8](https://github.com/fullofcaffeine/genes-ts/commit/5da5ac874445f4d68be28fafe043c8f1b1b2ee44))

# [1.4.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.3.0...v1.4.0) (2026-02-01)


### Features

* **ts2hx:** expression coverage ([a3cbca3](https://github.com/fullofcaffeine/genes-ts/commit/a3cbca3f66fbb2997916148487b7878d21d74d2b))

# [1.3.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.2.0...v1.3.0) (2026-01-31)


### Features

* **ts2hx:** basic statement coverage ([da682ea](https://github.com/fullofcaffeine/genes-ts/commit/da682ea70f8f9c7d8c4b3d95b4fc042b6218d083))

# [1.2.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.1.3...v1.2.0) (2026-01-31)


### Bug Fixes

* **ci:** make workflow valid (no env in job name) ([0c2c5d9](https://github.com/fullofcaffeine/genes-ts/commit/0c2c5d9f9cbf1773bc6a59f9f7876e3dee86f40d))
* **ci:** run classic job on ubuntu; allow mac failure ([cc491a0](https://github.com/fullofcaffeine/genes-ts/commit/cc491a08b4c064c4b009630f06cbf11dcd80081e))


### Features

* **ts2hx:** add advanced roundtrip fixture ([3ad0bcc](https://github.com/fullofcaffeine/genes-ts/commit/3ad0bcc8ae85a78c9c35fd00b684598a299abaaa))
* **ts2hx:** add roundtrip fixture snapshots ([01c8fa0](https://github.com/fullofcaffeine/genes-ts/commit/01c8fa0eee695a8528832f03f46a56e4a507792d))
* **ts2hx:** local export lists ([03805f0](https://github.com/fullofcaffeine/genes-ts/commit/03805f0e61085fb3ef865558214a07f8ed5fea84))
* **ts2hx:** module syntax (default/namespace/re-export) ([cfad4f0](https://github.com/fullofcaffeine/genes-ts/commit/cfad4f077c26b0c34c562597b1e6f6fd974df202))
* **ts2hx:** non-relative imports via extern modules ([14524de](https://github.com/fullofcaffeine/genes-ts/commit/14524de6807d6cef07c4f88b4d1f0b5b2d9442e6))
* **ts2hx:** object methods and spreads ([18c31eb](https://github.com/fullofcaffeine/genes-ts/commit/18c31ebdf8b41d72dc7bdb7d0783fcf885059c78))
* **ts2hx:** type-literal structs ([a997370](https://github.com/fullofcaffeine/genes-ts/commit/a997370fc6e9346b33824e0d0d6e9f7dcd6abe54))

## [1.1.3](https://github.com/fullofcaffeine/genes-ts/compare/v1.1.2...v1.1.3) (2026-01-25)


### Bug Fixes

* **genes-ts:** tighten exception payload types ([ad62ba4](https://github.com/fullofcaffeine/genes-ts/commit/ad62ba4da91543ee133c6ec3143bf38fb51c17c7))

## [1.1.2](https://github.com/fullofcaffeine/genes-ts/compare/v1.1.1...v1.1.2) (2026-01-25)


### Bug Fixes

* **genes-ts:** type DOM iterators ([fb12569](https://github.com/fullofcaffeine/genes-ts/commit/fb125698a89f5fb2b2f39eb8430958903f275f16))

## [1.1.1](https://github.com/fullofcaffeine/genes-ts/compare/v1.1.0...v1.1.1) (2026-01-25)


### Bug Fixes

* **genes-ts:** avoid any in iterator results ([bf722dd](https://github.com/fullofcaffeine/genes-ts/commit/bf722dd136f1acf709ec8880e4b3669a93465f41))

# [1.1.0](https://github.com/fullofcaffeine/genes-ts/compare/v1.0.2...v1.1.0) (2026-01-24)


### Bug Fixes

* **ci:** ensure classic artifacts for ts_full ([e37f0b6](https://github.com/fullofcaffeine/genes-ts/commit/e37f0b67187ed4bda6455e9cb97b65a449435d51))
* **ci:** stabilize acceptance and classic matrix ([c8de215](https://github.com/fullofcaffeine/genes-ts/commit/c8de21528a20172aba002ccf1675c98fe00a6fb8))
* unblock todoapp TS strict + e2e ([da9cf8d](https://github.com/fullofcaffeine/genes-ts/commit/da9cf8d0758a27229e7abade1eb67d7408e72f68))


### Features

* **ts:** emit literal unions for enum abstracts ([569f052](https://github.com/fullofcaffeine/genes-ts/commit/569f0520a02c176be87ea3769c7beb6873c3cb63))

# Changelog

This file is maintained by **semantic-release**.
