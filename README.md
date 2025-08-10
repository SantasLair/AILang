# AILang

A machine-native, declarative, schema-driven language for AI agents. Focused on semantic clarity, probabilistic reasoning hooks, and transformation logic.

Highlights:
- Tasks (`@task:`), blocks (`%in`, `%model`, `%out`)
- Graph nodes/edges (`+node`, `->from=>to`) for structure
- Conditions (`?`) and actions (`!if ... then ...`)
- Built-in sort model with bubble sort
- Minimal let-bindings and expressions (numbers/strings/booleans, + - * /, member access)

Setup:
- `npm install`
- `npm run build`
- `node dist/src/main.js <file.ailang>`
- `npm test`

Grammar (summary):
- Task: `@id:`
- Input: `%in:` followed by JSON
- Model: `%model:type{key=value,...}`
- Output: `%out: name`
- Node: `+name:type[range]`
- Edge: `->from=>to`
- Condition: `?lhs [op rhs]` where `op` in `=,==,>=,<=,>,<`
- Action: `!if condition then (emit name | log "msg" | set var=value)`
- Let: `let name = expr` where expr supports numbers/strings/booleans/null, identifiers, member access, and + - * /

Example: Bubble sort
```
@bubblesort:
%in:
[9,1,5,6,2,5]
%model:sort{algorithm=bubble}
%out: sorted
```

Example: Confidence-based action
```
@conf_action:
%in:
{ "list": [9,1,5,6,2,5], "confidence": 0.92 }
%model:sort{algorithm=bubble}
!if confidence >= 0.8 then emit high
```

Run:
- `node dist/src/main.js path/to/task.ailang`
- Expected output for bubble sort: `[1,2,5,5,6,9]`

Notes:
- The interpreter prefers `ctx.sorted` for `%out` if present, otherwise falls back to `%in` value.
- Extend `src/compiler.ts` to add more models, richer condition evaluation, and messaging/macros as needed.

Example: Let-binding and arithmetic
```
@calc:
%in:
{ "x": 3, "obj": { "y": 4 } }
let z = x * 2 + obj.y
!if z >= 10 then emit z
```
