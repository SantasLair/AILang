## AILang: An AI-Native General-Purpose Language (Vision)

This document sketches goals and a pragmatic path to evolve AILang into a general-purpose programming language designed for AI to read, write, reason about, and execute efficiently.

### Goals

- Machine-first clarity: stable grammar and canonical formatting to reduce ambiguity for LLMs and tooling.
- Efficient execution: vectorization, batching, caching, and compilation to fast runtimes (JS/WASM/Python/CUDA backends).
- Hybrid semantics: symbolic programming with first-class probabilistic values (distributions, scores) and tensor types.
- Explainability: explicit intent and metadata for nodes/edges, effects, and models; deterministic lowering to IR.
- Toolability: simple EBNF, AST, IR, and transforms; predictable linting/formatting; incremental type inference.

### Design pillars

1) Canonical surface syntax
- Deterministic pretty-printer; no optional punctuation; minimal aliases.
- Declarative blocks for data, models, outputs, and policies; functional expressions for compute.

2) Core types
- scalar: number | string | boolean | null
- json: object/array (for interop)
- tensor<D, dtype>
- dist<T>: probability distributions (e.g., Normal, Categorical)
- text/msg: structured text with fields and tags
- graph<N,E>: typed graphs for plans and dataflow
- tool: callable external capability (HTTP, DB, vector index)

3) Effects and planning
- Pure core with effect system: io, model, tool, time, randomness.
- Schedulers plan batches across models/tools; costs tracked in IR for optimization.

4) IR and compilation
- SSA-like graph IR with nodes (ops, models, effects) and typed edges.
- Lowering chain: AST -> IR -> target (JS/TS today; WASM/Python later).
- Optimization passes: constant folding, CSE, dead code, batch fusion, caching.

5) Performance features
- Canonicalization for cache keys (AST/IR hashing with context subset).
- Built-in batching and vectorization over tensors and prompts.
- Memoization of model/tool calls under deterministic contexts.

### Syntax sketch (incremental)

Current AILang (subset implemented):
- Task: `@task:`
- Input: `%in:` JSON
- Model: `%model:sort{algorithm=bubble}`
- Output: `%out: name`
- Conditions/actions: `?x >= 0`, `!if cond then emit name | log "msg" | set var=1`

Planned general-purpose additions (backward compatible):
- let bindings: `let x = 1 + 2 * y`
- functions: `def add(a:number, b:number) -> number { return a + b }`
- tensors: `tensor[2,3]([[1,2,3],[4,5,6]])`
- distributions: `let z ~ Normal(mu, sigma)` (tilde binds sampling or symbolic dist)
- calls/tools: `%tool:http{url="https://...", method=GET}`; `call tool with {payload}`
- policies: `policy when score >= 0.8 then emit high`
- modules/imports: `use math as m`

These features map to a unified IR; effects (model/tool) remain explicit for scheduling and caching.

### Migration path in this repo

Phase 1 (done/minimal):
- Parser + executor for tasks, %in/%model/%out, conditions/actions.
- Built-in `sort` model and simple action runtime.

Phase 2 (near-term):
- Expressions and let-bindings (arithmetic, logical, property access).
- Canonical pretty-printer and formatter.
- Basic type system (scalars/json first) with errors/warnings.

Phase 3 (mid-term):
- IR and optimizer passes; compile to JS target modules.
- Model abstraction for pluggable backends; memoization and batching.

Phase 4 (longer-term):
- Tensors and dtypes; vectorized ops.
- Distributions and simple probabilistic inference primitives.
- WASM/Python backends; tool registry and auth/limits.

### Example (today)

```
@bubblesort:
%in:
[9,1,5,6,2,5]
%model:sort{algorithm=bubble}
%out: sorted
```

### Example (future sketch)

```
@rank_products:
%in:
{ "products": [{"id":1,"score":0.7},{"id":2,"score":0.9}], "k": 1 }
let sorted = sort(products by .score desc)
let topk = take(sorted, k)
!if k >= 1 then emit topk
%out: topk
```

### Notes
- Keep syntax machine-friendly and regular; prefer keywords over punctuation tricks.
- Every new construct should have a direct IR op and clear lowering.
