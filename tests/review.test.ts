import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, renderReview, reviewProblem, localDate } from "../src/review-model";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownContent } from "../src/review-view";
import { reviewEmail } from "../worker/review-email";
import { digest } from "../worker/auth";
test("site and email share escaped Markdown without remote images or executable links", () => {
  const brief = '# Today — Review\n## Do today\n<script>alert(1)</script>\n[bad](javascript:alert(1))\n![track](https://example.com/pixel)\n[Work](https://github.com/acme/work/issues/940)\n## Calendar\nNone.\n## Now\nReady.';
  const html = renderReview(brief);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('href="https://github.com/acme/work/issues/940"'));
  const now = Date.now();
  const review = {date:localDate(now), verifiedAt:now, sourceCommit:'a'.repeat(40), brief, briefSha256:digest(brief)};
  const email = reviewEmail(review, {from: 'reports@example.com', to: 'owner@example.com', site: 'https://projects.example.com', repo: 'acme/work'});
  assert.ok(email.html.includes(html));
  assert.ok(email.text.includes(`https://github.com/acme/work/blob/${'a'.repeat(40)}/today.md`));
  assert.ok(!reviewEmail(review, {from: 'reports@example.com', to: 'owner@example.com', site: 'https://projects.example.com'}).html.includes('today.md'));
  assert.equal(reviewProblem(review, now), null);
  assert.equal(localDate(Date.parse('2026-10-04T13:30:00Z'), 'Etc/GMT-11'), '2026-10-05', "today is the deployment's own day");
  assert.equal(reviewProblem({...review, date: localDate(now, 'Etc/GMT-11')}, now, 'Etc/GMT+11') !== null, localDate(now, 'Etc/GMT-11') !== localDate(now, 'Etc/GMT+11'));
});

test("agent replies render readable Markdown and preserve exact collateral editions", () => {
  const link = `https://github.com/acme/work/blob/${"a".repeat(40)}/guides/Project%20plan.md#L12`;
  const reply = `**The draft is ready for review.**\n\n[Project plan — draft](${link})\n\n| Area | Position |\n| --- | --- |\n| Australia | Ready |\n| UK | Samples needed |\n\n- Two decisions remain.\n- Nothing has been sent.\n\n\`Saved draft\` is not an approved release.`;
  const html = renderToStaticMarkup(React.createElement(MarkdownContent, {text: reply, className: "run-markdown"}));
  assert.match(html, /class="run-markdown"/);
  assert.match(html, /<strong>The draft is ready for review\.<\/strong>/);
  assert.match(html, /<table>[\s\S]*<th>Area<\/th>[\s\S]*<td>Samples needed<\/td>/);
  assert.match(html, /<ul>[\s\S]*<li>Nothing has been sent\.<\/li>/);
  assert.ok(html.includes(`href="${link}"`));
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /<code>Saved draft<\/code>/);
});

test("untrusted agent Markdown cannot create active HTML, tracking images or unsafe links", () => {
  const reply = `<script>alert(1)</script>\n\n<img src="https://example.com/track" onerror="alert(1)">\n\n<iframe src="https://example.com"></iframe>\n\n![tracker](https://example.com/pixel)\n\n[script](javascript:alert%281%29)\n\n[encoded](jav&#x61;script:alert%281%29)\n\n[data](data:text/html;base64,AAAA)\n\n[file](file:///Users/someone/private)\n\n[relative](/api/runs)\n\n[credentials](https://user:password@example.com/)\n\n[http](http://example.com/)\n\n[safe](https://example.com/report?q=%22onclick%3Dalert%281%29)`;
  const html = renderMarkdown(reply);
  assert.doesNotMatch(html, /<(script|img|iframe)\b/i);
  assert.deepEqual([...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]), [
    "https://example.com/pixel", // disabled image syntax is a link, never a request
    "https://example.com/report?q=%22onclick%3Dalert%281%29",
  ]);
  assert.match(html, /href="https:\/\/example.com\/report\?q=%22onclick%3Dalert%281%29"/);
  assert.doesNotMatch(html, /\son(?:click|error)="/);
  assert.match(html, /&lt;script&gt;/);
});
