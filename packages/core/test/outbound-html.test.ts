import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyseOutboundHtml } from '../src/sanitize.ts';

// ── Escaped markup is text ──────────────────────────────────────────────────────────────────────────────────────

test('markup written as entities is text a recipient reads, and stays in the text compared', () => {
  // The conversion re-serialised decoded text without escaping it, so `&lt;!-- … --&gt;` became a comment and
  // `&lt;x&gt;` an unknown tag, and both vanished from the comparison while a mail client showed them literally.
  const cases: [string, string][] = [
    ['<p>Hi Sam&lt;!-- IBAN GB00EVIL --&gt;</p>', 'Hi Sam<!-- IBAN GB00EVIL -->'],
    ['<p>Hi Sam &lt;IBAN-GB00EVIL&gt; bye</p>', 'Hi Sam <IBAN-GB00EVIL> bye'],
    ['<p>On Thu, Sam Lee &lt;sam@partner.test&gt; wrote:</p>', 'On Thu, Sam Lee <sam@partner.test> wrote:'],
    ['<p>a &amp;lt; b &amp; c</p>', 'a &lt; b & c'],
  ];
  for (const [html, text] of cases) {
    const report = analyseOutboundHtml(html);
    assert.equal(report.comparableText, text, html);
    assert.equal(report.visibleText, text, html);
  }
  // Links keep their real target, with an ampersand in the query.
  const linked = analyseOutboundHtml(
    '<a href="https://example.test/p?a=1&amp;b=2">https://example.test/p?a=1&amp;b=2</a>',
  );
  assert.equal(linked.comparableText, 'https://example.test/p?a=1&b=2');
  assert.deepEqual(linked.urls, [{ where: 'a[href]', url: 'https://example.test/p?a=1&b=2' }]);
});
