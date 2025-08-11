# AILang

A machine-native, declarative, schema-driven language for AI agents. Focused on semantic clarity, probabilistic reasoning hooks, and transformation logic.

Highlights:
- Tasks (`@task:`), blocks (`%in`, `%model`, `%out`)
- Graph nodes/edges (`+node`, `->from=>to`) for structure
- Conditions (`?`) and actions (`!if ... then ...`)
- Built-in sort model with bubble sort
- Minimal let-bindings and expressions (numbers/strings/booleans, + - * /, member access)
 - Tool requests via `%model:tool{...}` captured into context for an agent to execute

Setup:
- `npm install`
- `npm run build`
- `node dist/src/main.js <file.ailang>`
- Compile to bytecode: `node dist/src/main.js --compile file.ailang file.albc`
- Run bytecode: `node dist/src/main.js --runbc file.albc`
- Pipe from stdin: `type file.ailang | node dist/src/main.js --stdin`
- REPL: `node dist/src/main.js --repl` (enter program, then a line with `RUN`)
- Watch-run: `node dist/src/main.js --watch file.ailang`

HTTP server (no dependencies):
- Start: `npm run serve` (default port 8787)
- GET /health -> { ok: true }
- POST /run with body: { "source": "@task..." } or raw text -> { outputs, context }
- POST /compile with body: { "source": "@task..." } -> { bytecode: base64, bytes }
- POST /runbc with body: { bytecode: base64 } -> { outputs, context }

PowerShell helper (tools/run-ailang.ps1):
- Run a program via local server and save results:
	- `powershell -ExecutionPolicy Bypass -File tools/run-ailang.ps1 -SourcePath examples/sort.ailang -OutJson out.json -CtxJson ctx.json`
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
 - Agent pattern: `%model:tool{...}` appends a request into `ctx.__requests` and mirrors it to `ctx.plan`.

Agent usage example:
```
@writefile:
%in:
{ "file": "examples/out.txt", "content": "hello" }
%model:tool{name=fs.write, file=file, content=content}
!if true then emit plan
```
An external agent would read `result.context.plan` and perform the fs.write call with resolved args.

Example: Let-binding and arithmetic
```
@calc:
%in:
{ "x": 3, "obj": { "y": 4 } }
let z = x * 2 + obj.y
!if z >= 10 then emit z
```
