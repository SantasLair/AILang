import { strict as assert } from 'assert';
import { parseSource, execute, parseAndExecuteSource } from '../src/compiler';
import { compileToBytecode, runBytecode } from '../src/bytecode';

// Bubble sort test
{
  const src = `
@bubblesort:
%in:
[9,1,5,6,2,5]
%model:sort{algorithm=bubble}
%out: sorted
`.trim();
  const res = parseAndExecuteSource(src);
  const out = res.outputs['sorted'];
  assert.deepEqual(out, [1, 2, 5, 5, 6, 9], 'Bubble sort output mismatch');
  console.log('✓ bubble sort');
}

// Confidence-based action trigger
{
  const src = `
@conf_action:
%in:
{ "list": [9,1,5,6,2,5], "confidence": 0.92 }
%model:sort{algorithm=bubble}
!if confidence >= 0.8 then emit high
`.trim();
  const ast = parseSource(src);
  const res = execute(ast);
  assert.deepEqual(res.outputs['high'], [1, 2, 5, 5, 6, 9], 'Action emit should use sorted result');
  console.log('✓ confidence-based action trigger');
}

// Invalid syntax detection
{
  const bad = `
@badtask:
+badnode
`.trim();
  let threw = false;
  try {
    parseSource(bad);
  } catch {
    threw = true;
  }
  assert.equal(threw, true, 'Parser should throw on invalid syntax');
  console.log('✓ invalid syntax detection');
}

// Bytecode parity: bubble sort
{
  const src = `
@bubblesort:
%in:
[9,1,5,6,2,5]
%model:sort{algorithm=bubble}
%out: sorted
`.trim();
  const ast = parseSource(src);
  const bc = compileToBytecode(ast);
  const res = runBytecode(bc, [9,1,5,6,2,5]); // also seed input, but model will use it
  const out = res.outputs['sorted'];
  assert.deepEqual(out, [1, 2, 5, 5, 6, 9], 'Bytecode output mismatch');
  console.log('✓ bytecode parity (bubble sort)');
}
// Let-binding evaluation
{
  const src = `
@calc:
%in:
{ "x": 3, "obj": { "y": 4 } }
let z = x * 2 + obj.y
!if z >= 10 then emit z
`.trim();
  const res = parseAndExecuteSource(src);
  // z = 3*2 + 4 = 10
  const out = res.outputs['z'];
  assert.equal(out, 10, 'Let-binding arithmetic/member access failed');
  console.log('✓ let-binding evaluation');
}
