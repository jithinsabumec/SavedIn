import type { Post } from "./types";

type MatchRange = [number, number];

export interface SearchResult {
  item: Post;
  ranges: MatchRange[];
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function searchPosts(query: string, posts: Post[]): SearchResult[] {
  const q = query.trim();
  if (!q) return posts.map((post) => ({ item: post, ranges: [] }));

  const qLower = q.toLowerCase();
  const matched: SearchResult[] = [];

  for (const post of posts) {
    const textLower = post.postText.toLowerCase();
    const authorLower = post.authorName.toLowerCase();
    if (!textLower.includes(qLower) && !authorLower.includes(qLower)) continue;

    const ranges: MatchRange[] = [];
    let idx = 0;
    while ((idx = textLower.indexOf(qLower, idx)) !== -1) {
      ranges.push([idx, idx + q.length - 1]);
      idx += q.length;
    }
    matched.push({ item: post, ranges });
  }

  return matched;
}

export function buildHighlightedPreview(text: string, ranges: MatchRange[]): string {
  const WINDOW = 300;
  const PAD = 80;

  if (!ranges || ranges.length === 0) {
    const preview = text.slice(0, WINDOW) + (text.length > WINDOW ? "…" : "");
    return escapeHtml(preview);
  }

  const [firstStart] = ranges[0];
  const winStart = Math.max(0, firstStart - PAD);
  const winEnd = winStart + WINDOW;
  const excerpt = text.slice(winStart, winEnd);
  const leadEllipsis = winStart > 0;
  const trailEllipsis = winEnd < text.length;

  const local = ranges
    .map(([start, end]) => [start - winStart, end - winStart] as MatchRange)
    .filter(([start, end]) => end >= 0 && start < excerpt.length)
    .map(([start, end]) => [Math.max(0, start), Math.min(end, excerpt.length - 1)] as MatchRange);

  let html = leadEllipsis ? "…" : "";
  let cursor = 0;

  for (const [start, end] of local) {
    if (start > cursor) html += escapeHtml(excerpt.slice(cursor, start));
    html += `<mark>${escapeHtml(excerpt.slice(start, end + 1))}</mark>`;
    cursor = end + 1;
  }

  if (cursor < excerpt.length) html += escapeHtml(excerpt.slice(cursor));
  if (trailEllipsis) html += "…";

  return html;
}
