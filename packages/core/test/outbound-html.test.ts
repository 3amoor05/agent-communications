import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyseOutboundHtml, type OutboundHtmlReport } from '../src/sanitize.ts';

/**
 * What the outbound analyser must report so that a sender can refuse HTML whose rendering is not the text it was
 * compared with.
 *
 * The comparison a sender makes is between the text part (what the person approving reads) and the HTML's text in
 * source order. Everything here is a way for a mail client to show the recipient something else: text a stylesheet
 * adds, text a client reorders or mirrors, pixels, and resources fetched on open. Each one was accepted and sent before
 * this file existed.
 */

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function reasons(report: OutboundHtmlReport): string {
  return report.alterations.map((entry) => `${entry.where}: ${entry.reason}`).join('\n');
}

function clean(report: OutboundHtmlReport, html: string): void {
  assert.deepEqual(report.alterations, [], `${html}\n${reasons(report)}`);
  assert.deepEqual(report.images, [], html);
  assert.deepEqual(report.remoteResources, [], html);
  assert.deepEqual(report.hidden, [], html);
  assert.equal(report.scripts + report.forms + report.formFields, 0, html);
}

// ── The review's inputs, each accepted and sent before ──────────────────────────────────────────────────────────

test('a <style> block is reported: `::before { content }` adds text the text part never had', () => {
  const html =
    '<style>p.x::before{content:"Our bank details changed: pay IBAN GB00EVIL0000. "}</style>' +
    '<p class="x">Hi Sam, see you Tuesday.</p>';
  const report = analyseOutboundHtml(html);
  assert.equal(report.comparableText, 'Hi Sam, see you Tuesday.', 'the text comparison alone cannot see it');
  assert.ok(
    report.alterations.some((entry) => entry.where === 'style' && /<style>/.test(entry.reason)),
    reasons(report),
  );
});

test('`@import "…"` in a <style> block is a load on open, though it is not written as url()', () => {
  const report = analyseOutboundHtml(
    '<style>@import "https://tracker.evil.test/open.css?u=sam";</style><p>Hi Sam, see you Tuesday.</p>',
  );
  assert.deepEqual(report.remoteResources, ['https://tracker.evil.test/open.css?u=sam']);
  assert.ok(report.alterations.some((entry) => entry.where === 'style'));
});

test('SVG <image href> and <image xlink:href> load on open, are images, and the <svg> is reported', () => {
  for (const attribute of ['href', 'xlink:href']) {
    const url = `https://tracker.evil.test/p.png?a=${attribute}`;
    const report = analyseOutboundHtml(
      `<svg width="1" height="1"><image ${attribute}="${url}" width="1" height="1"/></svg><p>Hi Sam.</p>`,
    );
    assert.deepEqual(report.remoteResources, [url], attribute);
    assert.deepEqual(
      report.images.map((image) => image.url),
      [url],
      attribute,
    );
    assert.ok(report.urls.some((entry) => entry.url === url && entry.where === `image[${attribute}]`));
    assert.ok(
      report.alterations.some((entry) => entry.where === 'svg'),
      reasons(report),
    );
  }
  // The other SVG elements that fetch what they point at.
  for (const element of ['<feImage href="https://t.test/f.png"/>', '<use xlink:href="https://t.test/s.svg#a"/>']) {
    const report = analyseOutboundHtml(`<svg>${element}</svg>`);
    assert.equal(report.remoteResources.length, 1, element);
  }
  // An feImage draws what it points at, fetched or not.
  assert.deepEqual(analyseOutboundHtml('<svg><feImage href="cid:f"/></svg>').images, [
    { where: 'feimage[href]', url: 'cid:f' },
  ]);
});

test('an image is reported whatever its source: data:, cid:, relative, or none at all', () => {
  const report = analyseOutboundHtml(
    `<p>Hi Sam.</p><img src="data:image/png;base64,${PNG_1x1}" width="600" height="200">` +
      '<img src="cid:logo@acme.test"><img src="logo.png"><img alt="Pay IBAN GB00EVIL">',
  );
  assert.deepEqual(report.remoteResources, [], 'none of these is fetched from the internet');
  assert.deepEqual(
    report.images.map((image) => image.url),
    [`data:image/png;base64,${PNG_1x1}`, 'cid:logo@acme.test', 'logo.png', ''],
  );
  assert.equal(report.comparableText, 'Hi Sam.', 'the text comparison alone cannot see any of them');
});

test('every other way to draw a picture is an image too', () => {
  const cases: [string, string][] = [
    ['<input type="image" src="data:image/png;base64,AA">', 'input[src]'],
    ['<picture><source srcset="data:image/png;base64,AA 1x"><img src="cid:x"></picture>', 'source[srcset]'],
    ['<video poster="cid:poster"></video>', 'video[poster]'],
    ['<video src="cid:clip"></video>', 'video[src]'],
    ['<audio src="cid:clip"></audio>', 'audio[src]'],
    ['<table background="cid:bg"><tr><td>x</td></tr></table>', 'table[background]'],
    ['<td style="background-image:url(data:image/png;base64,AA)">x</td>', 'td[style]'],
    ['<div style="background:image-set(&quot;cid:x&quot; 1x)">x</div>', 'div[style]'],
    ['<li style="list-style-image:url(cid:dot)">x</li>', 'li[style]'],
    ['<img lowsrc="cid:low">', 'img[lowsrc]'],
    ['<img dynsrc="cid:clip">', 'img[dynsrc]'],
    ['<video></video>', 'video'],
    ['<audio controls></audio>', 'audio'],
  ];
  for (const [html, where] of cases) {
    const report = analyseOutboundHtml(html);
    assert.ok(
      report.images.some((image) => image.where === where),
      `${html}: ${JSON.stringify(report.images)}`,
    );
  }
  // A `data:` URL in a srcset holds a comma of its own; the candidate runs to whitespace, not to that comma.
  const srcset = analyseOutboundHtml('<img srcset="data:image/png;base64,AA 1x, https://t.test/b.png 2x">');
  assert.deepEqual(
    srcset.images.map((image) => image.url),
    ['data:image/png;base64,AA', 'https://t.test/b.png'],
  );
  assert.deepEqual(srcset.remoteResources, ['https://t.test/b.png']);
});

test('<bdo dir="rtl"> is reported: a client shows 87654321 where the text says 12345678', () => {
  const report = analyseOutboundHtml('<p>Pay to account <bdo dir="rtl">12345678</bdo> today.</p>');
  assert.equal(report.comparableText, 'Pay to account 12345678 today.');
  assert.ok(
    report.alterations.some((entry) => entry.where === 'bdo'),
    reasons(report),
  );
});

// ── Bidi reordering beyond <bdo> ────────────────────────────────────────────────────────────────────────────────

test('dir="rtl", and dir="auto" or <bdi> around right-to-left text, are reported; left-to-right is not', () => {
  const reordering = [
    '<p dir="rtl">Pay 123 456 today.</p>',
    '<p dir="RTL">Pay 123 456 today.</p>',
    '<div dir="auto">שלום 123 456</div>',
    '<p>Account <bdi>שלום 123</bdi> ok</p>',
    '<p>Account <span dir="auto">مرحبا 123</span> ok</p>',
  ];
  for (const html of reordering) {
    assert.ok(analyseOutboundHtml(html).alterations.length > 0, html);
  }
  const sameOrder = [
    '<div dir="ltr"><p>Pay 123 456 today.</p></div>',
    '<div dir="auto">Pay 123 456 today.</div>',
    '<p>Account <bdi>Sam 123</bdi> ok</p>',
    // Left to right is the direction a message already has, whatever the text inside.
    '<div dir="ltr">שלום 123 456</div>',
  ];
  for (const html of sameOrder) clean(analyseOutboundHtml(html), html);
});

test('a bidi control character in the HTML is reported, written raw or as an entity', () => {
  // The comparison strips invisible characters from the HTML side, so without this the text part could read
  // 12345678 while the HTML carried an override that shows it reversed.
  for (const html of [
    '<p>Pay \u202E12345678</p>',
    '<p>Pay &#x202E;12345678</p>',
    '<p>Pay &#8295;123&#8297;</p>',
    '<p>12&#x200F; 34</p>',
    '<p>12&#x200E; 34</p>',
    '<p>12&#x061C; 34</p>',
  ]) {
    const report = analyseOutboundHtml(html);
    assert.ok(
      report.alterations.some((entry) => /bidi control/.test(entry.reason)),
      `${html}: ${reasons(report)}`,
    );
  }
});

// ── Inline CSS that adds, reorders, moves or mirrors text ───────────────────────────────────────────────────────

test('inline CSS that can change what text is shown or its order is reported, prefixed or not', () => {
  const cases = [
    'content:"IBAN GB00EVIL"',
    'direction:rtl',
    'unicode-bidi:bidi-override',
    'writing-mode:vertical-rl',
    '-webkit-writing-mode:vertical-rl',
    'text-orientation:upright',
    'transform:scaleX(-1)',
    '-webkit-transform:rotate(180deg)',
    'rotate:180deg',
    'scale:-1 1',
    'translate:40px 0',
    'offset-path:path("M0 0 L100 0")',
    '-webkit-box-reflect:right',
    'float:right',
    'position:relative;left:-40px',
    'order:-1',
    '-webkit-box-ordinal-group:2',
    '-ms-flex-order:2',
    'display:flex;flex-direction:row-reverse',
    'display:flex;flex-flow:column-reverse',
    'display:flex;flex-wrap:wrap-reverse',
    '-webkit-box-direction:reverse',
    'grid-area:1 / 2',
    'grid-row:2',
    'display:table-footer-group',
    'display:table-header-group',
    'display:table-caption',
    'caption-side:bottom',
    'counter-reset:list-item 41',
    'counter-increment:list-item -2',
    'list-style-type:"IBAN GB00EVIL "',
    'list-style:symbols(cyclic "7")',
    'quotes:"IBAN " ""',
    'text-overflow:"IBAN GB00EVIL"',
    'text-emphasis-style:"7"',
    'text-emphasis:"7"',
    'hyphenate-character:"GB00EVIL"',
    '-webkit-text-security:disc',
  ];
  for (const style of cases) {
    const html = `<p style='${style}'>Pay 12345678</p>`;
    const report = analyseOutboundHtml(html);
    assert.ok(
      report.alterations.some((entry) => entry.where === 'p[style]'),
      `${style} was not reported`,
    );
  }
});

test('a style attribute this check cannot read — CSS escapes or comments — is reported', () => {
  // `u\72l(` is url(, and `con\74ent` is content, to a browser; a comment can split a property from its colon.
  for (const style of [
    'background:u\\72l(https://t.test/x.png)',
    'con\\74ent:"x"',
    'direction/**/:rtl',
    'color:red/* */',
  ]) {
    const report = analyseOutboundHtml(`<p style='${style}'>x</p>`);
    assert.ok(
      report.alterations.some((entry) => /cannot read/.test(entry.reason)),
      `${style}: ${reasons(report)}`,
    );
  }
});

// ── Other markup a client shows differently from its source order ───────────────────────────────────────────────

test('elements that load styles, embed documents, show markup as text or retarget links are reported', () => {
  const cases: [string, string][] = [
    ['<link rel="stylesheet" href="data:text/css,p::before{content:%22x%22}">', 'link'],
    ['<base href="https://evil.test/"><a href="invoice">invoice</a>', 'base'],
    ['<iframe srcdoc="&lt;p&gt;IBAN GB00EVIL&lt;/p&gt;"></iframe>', 'iframe'],
    ['<object data="data:text/html,IBAN"></object>', 'object'],
    ['<embed src="data:image/svg+xml,x">', 'embed'],
    ['<math><mi>x</mi></math>', 'math'],
    ['<xmp><p title="IBAN GB00EVIL"></xmp>', 'xmp'],
    ['<plaintext><b>hi</b>', 'plaintext'],
    ['<listing>x</listing>', 'listing'],
    ['<frame src="cid:x">', 'frame'],
    ['<frameset><frame></frameset>', 'frameset'],
    ['<applet code="x.class"></applet>', 'applet'],
    ['<portal src="https://t.test/"></portal>', 'portal'],
    ['<fencedframe src="https://t.test/"></fencedframe>', 'fencedframe'],
  ];
  for (const [html, where] of cases) {
    const report = analyseOutboundHtml(html);
    assert.ok(
      report.alterations.some((entry) => entry.where === where),
      `${html}: ${reasons(report)}`,
    );
  }
});

test('table markup a client moves out of source order is reported', () => {
  const cases = [
    // A client moves anything that is not a cell out of the table, above it.
    '<table><tr><td>5678</td></tr>1234</table>',
    '<table><tr><td>5678</td><span>1234</span></tr></table>',
    '<table><tbody><tr><td>5678</td></tr><p>1234</p></tbody></table>',
    // A footer is drawn last and a header first, wherever they are written.
    '<table><tfoot><tr><td>1234</td></tr></tfoot><tbody><tr><td>5678</td></tr></tbody></table>',
    '<table><tbody><tr><td>5678</td></tr></tbody><thead><tr><td>1234</td></tr></thead></table>',
    '<table><tr><td>5678</td></tr><caption>1234</caption></table>',
  ];
  for (const html of cases) {
    const report = analyseOutboundHtml(html);
    assert.ok(report.alterations.length > 0, html);
  }
  clean(
    analyseOutboundHtml(
      '<table>\n<caption>Plan</caption><thead><tr><th>When</th></tr></thead>' +
        '<tbody>\n<tr>\n<td>Tuesday</td>\n</tr></tbody><tfoot><tr><td>End</td></tr></tfoot></table>',
    ),
    'a well-formed table',
  );
});

test('list numbers a client draws differently from the text are reported', () => {
  for (const html of [
    '<ol reversed><li>a</li><li>b</li></ol>',
    '<ol><li value="7">a</li></ol>',
    '<ol><li type="I">a</li></ol>',
  ]) {
    assert.ok(analyseOutboundHtml(html).alterations.length > 0, html);
  }
  // `start` and `type` on the list itself are read by the text conversion, so the text part shows the same numbers.
  for (const html of ['<ol start="4"><li>a</li></ol>', '<ol type="a"><li>a</li></ol>']) {
    clean(analyseOutboundHtml(html), html);
  }
});

// ── Remote is not only http(s) ──────────────────────────────────────────────────────────────────────────────────

test('a load on open is remote whatever the scheme, and a Windows share path is remote', () => {
  const report = analyseOutboundHtml(
    '<img src="file://evil.test/share/x.png"><img src="\\\\evil.test\\share\\y.png"><img src="ftp://evil.test/z.png">' +
      '<img src="//evil.test/w.png"><img src="data:image/png;base64,AA"><img src="cid:a@b">',
  );
  assert.deepEqual(report.remoteResources, [
    'file://evil.test/share/x.png',
    '\\\\evil.test\\share\\y.png',
    'ftp://evil.test/z.png',
    '//evil.test/w.png',
  ]);
  // Only what a message carries itself, or nothing, stays local; a scheme split by a tab is still read as one.
  const local = analyseOutboundHtml(
    '<img src="about:blank"><img src="blob:x"><img src="mid:part@acme.test"><img src="javascript:void(0)">',
  );
  assert.deepEqual(local.remoteResources, []);
  assert.deepEqual(analyseOutboundHtml('<img src="ht&#9;tp://evil.test/t.png">').remoteResources, [
    'ht\ttp://evil.test/t.png',
  ]);
});

// ── What stays allowed ──────────────────────────────────────────────────────────────────────────────────────────

test('ordinary formatting, links, lists, tables and the HTML this repository generates stay clean', () => {
  const allowed = [
    // Gmail's own composer, reply quote included.
    '<p>Tuesday works. See <a href="https://example.test/plan?v=2">https://example.test/plan?v=2</a>.</p>\n' +
      '<div class="gmail_quote">\n<div dir="ltr" class="gmail_attr">On Thu, Sam Lee &lt;sam@partner.test&gt; wrote:</div>\n' +
      '<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">\n' +
      '<p>Hello</p>\n</blockquote>\n</div>',
    // The markup Gmail's web editor writes for a plain message.
    '<div dir="ltr">Hi Sam,<div><br></div><div>See you <b>Tuesday</b>, <i>10am</i>, <u>room 4</u>.</div>' +
      '<div><span class="gmail_default" style="font-family:arial,sans-serif;color:rgb(34,34,34);font-size:small">' +
      'Jo</span></div></div>',
    '<ul><li style="margin-left:15px">one</li><li>two</li></ul><ol start="3"><li>three</li></ol>',
    '<p style="text-align:center;line-height:1.4;font-weight:bold;background-color:#fafafa;padding:4px 8px">x</p>',
    '<p style="position:static;float:none;transform:none;display:block">x</p>',
    // The values that leave text where it is written, for each property that can move it.
    '<p style="direction:ltr;unicode-bidi:normal;writing-mode:horizontal-tb;text-orientation:mixed">x</p>',
    '<p style="rotate:none;scale:none;translate:none;offset-path:none;flex-direction:column;flex-flow:row wrap">x</p>',
    '<p style="list-style-type:disc;quotes:none;text-overflow:ellipsis;display:table-cell">x</p>',
    '<font face="arial, sans-serif" color="#333">x</font><br><hr><h1>Title</h1><pre>code</pre><code>c</code>',
    '<p>Price: <s>£20</s> <strong>£15</strong> <em>today</em> <small>only</small> <sub>1</sub><sup>2</sup></p>',
    '<blockquote><p>quoted</p></blockquote><div dir="auto">Reply</div>',
    '<table style="border-collapse:collapse"><tr><td style="border:1px solid #ccc;padding:4px">a</td></tr></table>',
  ];
  for (const html of allowed) clean(analyseOutboundHtml(html), html);
});

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
