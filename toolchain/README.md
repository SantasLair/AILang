# AILang Toolchain

- Build: `npm run build`
- Run: `node dist/src/main.js <file.ailang>`
- Test: `npm test`

Example:

```
@bubblesort:
%in:
[9,1,5,6,2,5]
%model:sort{algorithm=bubble}
%out: sorted
```

CLI:

- `node dist/src/main.js examples/sort.ailang`
- Prints: `[1,2,5,5,6,9]`

Notes:

- `%in:` accepts JSON (objects or arrays).
- `%model:sort{algorithm=bubble}` runs a built-in bubble sort.
- `%out: name` emits the preferred value (sorted if available) as `name`.
- Actions:
  - `!if confidence >= 0.8 then emit high`
  - `!if true then log "done"`
  - `!if flag == true then set acknowledged=true`
