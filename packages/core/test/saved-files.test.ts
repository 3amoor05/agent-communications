import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileRisks, keptExtension } from '../src/saved-files.ts';

/*
 * The two answers a channel needs before it saves a stranger's file: which extension the saved file may keep, and
 * what its name says about opening it. Gmail's attachment download and Slack's file download both ask here.
 */

const RLO = String.fromCharCode(0x202e);

test('a saved file keeps only a document or image extension, lower-cased, read from the name it would be written under', () => {
  assert.equal(keptExtension('report.PDF'), '.pdf');
  assert.equal(keptExtension('photo.jpeg'), '.jpeg');
  // Anything that runs, renders or unpacks is saved with no extension at all, so opening it by accident runs nothing.
  for (const name of ['setup.exe', 'run.sh', 'page.html', 'logo.svg', 'bundle.zip', 'macro.docm', 'README', '']) {
    assert.equal(keptExtension(name), '', name);
  }
  // Trailing dots and spaces are what `safeFilename` strips on the way to disk; the extension is judged after that.
  assert.equal(keptExtension('invoice.pdf. '), '.pdf');
  assert.equal(keptExtension('invoice.exe '), '');
  // A right-to-left override hides the real extension from a person; the saved file keeps none of the disguise.
  assert.equal(keptExtension(`invoice${RLO}fdp.exe`), '');
});

test('the risks of a name are judged on the name as written to disk, and a bidi override on the name as given', () => {
  assert.deepEqual(fileRisks('invoice.pdf', 'application/pdf'), []);
  assert.deepEqual(fileRisks('setup.exe', 'application/octet-stream'), ['executable']);
  assert.deepEqual(fileRisks('install.sh', 'text/plain'), ['script']);
  assert.deepEqual(fileRisks('page.txt', 'text/html'), ['markup']);
  assert.ok(fileRisks('invoice.pdf.exe', 'application/octet-stream').includes('double-extension'));
  // `invoice.exe ` lands on disk as `invoice.exe`: the `$`-anchored rule has to see it that way.
  assert.deepEqual(fileRisks('invoice.exe ', 'application/octet-stream'), ['executable']);
  assert.ok(fileRisks(`invoice${RLO}fdp.exe`, 'application/pdf').includes('bidi-filename'));
});
