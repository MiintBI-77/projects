import MarkdownIt from "markdown-it";
import { z } from "zod";
export const REVIEW_MAX_AGE = 90 * 60_000;
export const reviewSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  verifiedAt: z.number().int().positive(),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  brief: z.string().min(30).max(20000),
  briefSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type Review = z.infer<typeof reviewSchema>;
export type PublishedReview = Review & { publishedAt: number; email: "not requested" | "pending" | "sent" | "failed" | "previous edition sent" | "previous edition pending" | "previous edition failed" };
// The deployment's calendar day, in its configured time zone.
export function localDate(at: number, timeZone = "UTC") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
export function reviewProblem(review: Review, now: number, timeZone = "UTC") {
  if (review.date !== localDate(now, timeZone)) return "Review is not from today";
  if (now - review.verifiedAt > REVIEW_MAX_AGE || review.verifiedAt > now + 300_000) return "Review source verification is stale";
  if (review.brief.split(/\s+/).filter(Boolean).length > 700) return "Review exceeds 700 words";
  if (!["# Today — ", "## Do today", "## Calendar", "## Now"].every((heading) => review.brief.includes(heading))) return "Review sections missing";
  return null;
}

// Raw HTML, images and non-HTTPS URLs cannot introduce content or tracking.
const markdown = new MarkdownIt({ html: false, linkify: false }).disable("image");
markdown.validateLink = (url: string) => {
  try { const u = new URL(url); return u.protocol === "https:" && !u.username && !u.password; }
  catch { return false; }
};
// Native output is untrusted: share the review's no-HTML/no-images/HTTPS-only boundary.
const renderLink = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet("target", "_blank");
  tokens[index].attrSet("rel", "noopener noreferrer");
  return renderLink
    ? renderLink(tokens, index, options, env, renderer)
    : renderer.renderToken(tokens, index, options);
};
export function renderMarkdown(text: string) { return markdown.render(text); }
// One line of agent text (a progress step or label): same rules, no block wrapper.
export function renderInlineMarkdown(text: string) { return markdown.renderInline(text); }
// A level-two section of the brief, without its heading.
export function briefSection(brief: string, heading: string) {
  const start = brief.split("\n").findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return null;
  const rest = brief.split("\n").slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2} /.test(line));
  return rest.slice(0, end < 0 ? undefined : end).join("\n").trim() || null;
}
export const renderReview = renderMarkdown;
