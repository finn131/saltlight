// @ts-nocheck
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(specifier + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});

const { slugifyProgramName, exportFilename, sanitizeImported, readProgramFile } = await import('../src/ui/filetools.ts');

test('acceptance 3: export filename is <name>.py', () => {
  assert.equal(exportFilename('my farm'), 'my_farm.py');
  assert.equal(exportFilename('Kelp Loop'), 'Kelp_Loop.py');
  assert.equal(exportFilename('draft.py'), 'draft.py', 'a .py suffix is not doubled');
});

test('filename: path separators and illegal characters are stripped', () => {
  assert.equal(exportFilename('../../etc/passwd'), 'etcpasswd.py');
  assert.equal(exportFilename('a/b\\c'), 'abc.py');
  assert.equal(exportFilename('wei!rd@na#me'), 'weirdname.py');
});

test('filename: empty or blank names fall back to "program"', () => {
  assert.equal(exportFilename(''), 'program.py');
  assert.equal(exportFilename('   '), 'program.py');
  assert.equal(exportFilename('...'), 'program.py');
});

test('acceptance 3: round trip is byte-identical', () => {
  const source = 'def f(a):\n    return a + 1\n\nfor i in range(0, 3):\n    report(i)\n';
  assert.equal(sanitizeImported(source), source);
});

test('import: a leading UTF-8 BOM is removed', () => {
  const withBom = '\uFEFFx = 1\n';
  assert.equal(sanitizeImported(withBom), 'x = 1\n');
});

test('import: CRLF and trailing whitespace are preserved', () => {
  const crlf = 'x = 1\r\ny = 2\r\n';
  assert.equal(sanitizeImported(crlf), crlf);
});

test('import: File.text() path yields the same bytes', async () => {
  const source = 'report("hi")\n';
  const file = new File([source], 'p.py', { type: 'text/x-python' });
  assert.equal(await readProgramFile(file), source);
});