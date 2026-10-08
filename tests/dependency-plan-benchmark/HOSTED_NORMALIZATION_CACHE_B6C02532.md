# Hosted dependency-normalization cache result

This is the durable comparison for the request-local declaration cache in
commit `b6c0253259ae4444b8def3335dfe250d52d5759b`. GitHub Actions run
`33966752693`, job `101308158773`, produced artifact `9969715309` from a clean
working tree.

The comparison uses the same benchmark code, seed `20260905`, five interleaved
rounds, Node 26.1.0, Haxe 4.3.7, Linux x64 runner class, and normal scheduling
priority as the pre-change sub-owner run `33965981879`. The one-minute load
average was 0.92 before and 1.00 after the optimized protocol.

## Result

| Edges | Pre-change wall median | Cached wall median | Change | Pre-change planner median | Cached planner median | Change | Pre-change normalization median | Cached normalization median | Change |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 128 | 2097 ms | 2048 ms | -2.3% | 0.210 s | 0.118 s | -43.8% | 0.142 s | 0.048 s | -66.2% |
| 256 | 3757 ms | 3479 ms | -7.4% | 0.719 s | 0.369 s | -48.7% | 0.543 s | 0.190 s | -65.0% |
| 512 | 9963 ms | 8900 ms | -10.7% | 2.566 s | 1.225 s | -52.3% | 2.072 s | 0.718 s | -65.3% |

The optimized 512-edge wall samples ranged from 8758 to 8921 ms. Planner
samples ranged from 1.208 to 1.231 Haxe-reported seconds. The five within-round
256-edge anchor drifts were 1.60%, 2.08%, 0.47%, 0.36%, and 0.77%.

The eight-times repeated-reference control still detected the planner owner,
but its median ratio fell from 8.10x to 4.89x. This is expected: declaration
normalization now occurs once, while the ordered graph still creates one edge
with occurrence-specific provenance for every typed reference.

## Output identity

Every pre-change and optimized case retained the same complete output hash:

- 128 edges: `b48bd6bff588ca6c3a7596a8b5bc08d842262349af4be2805b64b66e46f7c9ba`
- 256 edges: `0a0354406a8650747dca11d54260322bf77eea5e49492496b4f2e168321df374`
- 512 edges: `b268232278bd702f680f161aa7ec6b6f3f49075bcb5195571719dcae7b5d0d29`
- 128-edge 8x sensitivity: `57edd4f59cf71de00b17475b53b69906257a692bce93c0aa8451aa98c338e44e`

The ordinary fixtures also retained exactly 64/64, 128/128, and 256/256
runtime/type-only imports. These checks show that the cache removed repeated
normalization work without removing, reordering, or reclassifying dependency
edges.
