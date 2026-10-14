import { renderReview, type Review } from "../src/review-model";
// The daily email to the owner. The edition's source link needs the work
// repository, whose today.md the review was read from.
export function reviewEmail(
  review: Review,
  o: { from: string; to: string; site: string; repo?: string },
) {
  const source = o.repo
    ? `https://github.com/${o.repo}/blob/${review.sourceCommit}/today.md`
    : null;
  const checked = new Date(review.verifiedAt).toISOString();
  const text = `${review.brief}\n\nOpen Projects: ${o.site}\nSources checked: ${checked}${source ? `\nSame edition: ${source}` : ""}`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#20352a;line-height:1.6;max-width:720px;margin:auto;padding:24px">
<p><a href="${o.site}">Projects · your daily review</a></p>
<p style="color:#5c6b63;font-size:12px">Sources checked ${checked}. Later changes appear in Projects.</p>
${renderReview(review.brief)}${source ? `<p><a href="${source}">Same edition in today.md</a></p>` : ""}</body></html>`;
  return {
    from: { name: "Projects", email: o.from },
    to: [o.to],
    subject: `Projects — ${review.date}`,
    text,
    html,
  };
}
