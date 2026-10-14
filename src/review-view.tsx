import React from "react";
import {
  briefSection,
  renderInlineMarkdown,
  renderMarkdown,
  localDate,
  type PublishedReview,
} from "./review-model";
// HTML is produced only by the shared, HTML-disabled Markdown renderer.
export function MarkdownContent({ text, className }: { text: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}
export function InlineMarkdown({ text }: { text: string }) {
  return <span dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(text) }} />;
}
// Today's reviewed brief leads with its focus. An older edition never
// presents last week's priorities as today's.
export function TodayBrief({ review, now, repo, timeZone }: { review?: PublishedReview | null; now: number; repo?: string; timeZone?: string }) {
  if (!review) return null;
  const current = review.date === localDate(now, timeZone);
  const focus = current ? briefSection(review.brief, "Do today") : null;
  const full = (
    <>
      <MarkdownContent className="run-markdown" text={review.brief} />
      {repo && (
        <a href={`https://github.com/${repo}/blob/${review.sourceCommit}/today.md`} target="_blank" rel="noreferrer">
          Same edition in today.md
        </a>
      )}
    </>
  );
  if (!current)
    return (
      <details className="brief-old">
        <summary>Latest daily brief: {review.date}. No brief for today yet.</summary>
        {full}
      </details>
    );
  return (
    <section className="brief" aria-label="Today’s focus">
      <h2>Today’s focus</h2>
      {focus && <MarkdownContent className="run-markdown" text={focus} />}
      <details>
        <summary>Full daily brief</summary>
        {full}
      </details>
    </section>
  );
}
