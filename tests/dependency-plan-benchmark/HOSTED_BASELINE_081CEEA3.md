# Hosted dependency-plan attribution baseline

This is the durable review summary for GitHub Actions run `33952982602`, job
`101271080468`, artifact `9965464764`. The exact measured commit was
`081ceea38d54eb288c8955248a08ca2380307186`, with a clean working tree.

The runner used Node 26.1.0, Haxe 4.3.7, Linux x64, four logical CPUs, normal
priority, and one serial compiler child. The one-minute load average was 1.16
before the protocol and 1.06 after it. The exact command was:

```text
/opt/hostedtoolcache/node/26.1.0/x64/bin/node scripts/dist/benchmark-dependency-plan.js --out .tmp/dependency-plan-attribution.json
```

The protocol used seed `20260905`, five shuffled rounds bracketed by 256-edge
anchors, one warmup per fixture, an eight-times repeated-reference sensitivity
case, and three sensitivity pairs. Process wall time is in milliseconds. The
runtime and type columns are Haxe-reported seconds; they are valid for
same-run owner comparisons. Load columns are the one-minute average directly
before and after each child.

Every ordinary 128-, 256-, and 512-edge sample retained exactly 64/64,
128/128, and 256/256 runtime/type-only imports respectively. Their complete
output hashes were:

- 128 edges: `b48bd6bff588ca6c3a7596a8b5bc08d842262349af4be2805b64b66e46f7c9ba`
- 256 edges: `0a0354406a8650747dca11d54260322bf77eea5e49492496b4f2e168321df374`
- 512 edges: `b268232278bd702f680f161aa7ec6b6f3f49075bcb5195571719dcae7b5d0d29`
- 128-edge 8x sensitivity: `57edd4f59cf71de00b17475b53b69906257a692bce93c0aa8451aa98c338e44e`

| Seq | Round | Kind | Edges | Refs | Wall ms | Runtime | Type | Planner % | Load before | Load after |
| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 1 | anchor-before | 256 | 1x | 3080.6 | 0.106 | 0.486 | 20 | 1.27 | 1.27 |
| 1 | 1 | scale | 256 | 1x | 3051.5 | 0.100 | 0.479 | 19 | 1.27 | 1.33 |
| 2 | 1 | scale | 128 | 1x | 1687.5 | 0.029 | 0.141 | 11 | 1.33 | 1.33 |
| 3 | 1 | scale | 512 | 1x | 8082.3 | 0.314 | 1.764 | 26 | 1.33 | 1.28 |
| 4 | 1 | anchor-after | 256 | 1x | 3012.1 | 0.099 | 0.478 | 19 | 1.28 | 1.28 |
| 5 | 2 | anchor-before | 256 | 1x | 3031.2 | 0.100 | 0.483 | 19 | 1.28 | 1.26 |
| 6 | 2 | scale | 256 | 1x | 3021.7 | 0.100 | 0.478 | 19 | 1.26 | 1.24 |
| 7 | 2 | scale | 512 | 1x | 7985.3 | 0.312 | 1.742 | 26 | 1.24 | 1.22 |
| 8 | 2 | scale | 128 | 1x | 1670.6 | 0.029 | 0.140 | 11 | 1.22 | 1.22 |
| 9 | 2 | anchor-after | 256 | 1x | 3026.4 | 0.099 | 0.483 | 19 | 1.22 | 1.20 |
| 10 | 3 | anchor-before | 256 | 1x | 3016.6 | 0.099 | 0.478 | 19 | 1.20 | 1.18 |
| 11 | 3 | scale | 128 | 1x | 1680.1 | 0.029 | 0.140 | 11 | 1.18 | 1.18 |
| 12 | 3 | scale | 512 | 1x | 8081.4 | 0.317 | 1.757 | 26 | 1.18 | 1.16 |
| 13 | 3 | scale | 256 | 1x | 3164.6 | 0.104 | 0.510 | 19 | 1.16 | 1.16 |
| 14 | 3 | anchor-after | 256 | 1x | 3024.5 | 0.100 | 0.480 | 19 | 1.16 | 1.14 |
| 15 | 4 | anchor-before | 256 | 1x | 3031.1 | 0.100 | 0.478 | 19 | 1.14 | 1.14 |
| 16 | 4 | scale | 128 | 1x | 1688.1 | 0.029 | 0.140 | 11 | 1.14 | 1.13 |
| 17 | 4 | scale | 512 | 1x | 7980.3 | 0.312 | 1.740 | 26 | 1.13 | 1.12 |
| 18 | 4 | scale | 256 | 1x | 3005.8 | 0.099 | 0.476 | 19 | 1.12 | 1.11 |
| 19 | 4 | anchor-after | 256 | 1x | 3056.6 | 0.106 | 0.486 | 20 | 1.11 | 1.10 |
| 20 | 5 | anchor-before | 256 | 1x | 3026.3 | 0.099 | 0.483 | 19 | 1.10 | 1.10 |
| 21 | 5 | scale | 256 | 1x | 3030.3 | 0.100 | 0.478 | 19 | 1.10 | 1.09 |
| 22 | 5 | scale | 512 | 1x | 7985.3 | 0.307 | 1.737 | 26 | 1.09 | 1.08 |
| 23 | 5 | scale | 128 | 1x | 1683.4 | 0.029 | 0.141 | 11 | 1.08 | 1.08 |
| 24 | 5 | anchor-after | 256 | 1x | 3020.2 | 0.099 | 0.475 | 19 | 1.08 | 1.08 |
| 25 | - | sensitivity-baseline | 128 | 1x | 1686.7 | 0.029 | 0.140 | 11 | 1.08 | 1.07 |
| 26 | - | sensitivity-inflated | 128 | 8x | 5204.6 | 0.229 | 1.091 | 25 | 1.07 | 1.07 |
| 27 | - | sensitivity-inflated | 128 | 8x | 5224.0 | 0.231 | 1.107 | 25 | 1.07 | 1.06 |
| 28 | - | sensitivity-baseline | 128 | 1x | 1676.9 | 0.029 | 0.140 | 11 | 1.06 | 1.06 |
| 29 | - | sensitivity-baseline | 128 | 1x | 1680.6 | 0.029 | 0.140 | 11 | 1.06 | 1.06 |
| 30 | - | sensitivity-inflated | 128 | 8x | 5199.5 | 0.230 | 1.096 | 25 | 1.06 | 1.06 |

The ordinary scale medians were 1683.4, 3030.3, and 7985.3 ms. Combined
runtime/type-edge medians were 0.169, 0.578, and 2.054 Haxe-reported seconds.
The 512/128 ratios were 4.74x for wall time and 12.15x for planner time. The
five within-round anchor drifts were 2.25%, 0.16%, 0.26%, 0.84%, and 0.20%.
The sensitivity planner median rose from 0.169 to 1.326, a 7.85x increase.

At 512 edges, type-edge collection was 1.742 seconds and 22% of total. Runtime
edge collection was 0.312 seconds and 4%. TypeScript implementation emission
was 4.619 seconds and 58%, so planning is material but is not the majority
owner of complete build latency.
