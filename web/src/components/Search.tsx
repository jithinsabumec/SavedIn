import type { Post } from "@savedin/shared";
import { buildHighlightedPreview, searchPosts } from "@savedin/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { embedText } from "../lib/embeddingClient";
import { cosineSimilarity } from "../utils/cosineSimilarity";

const SEMANTIC_THRESHOLD = 0.25;
const SEMANTIC_TOP = 20;
const BACKFILL_BATCH = 5;

type Props = {
  posts: Post[];
  /** When the Search tab becomes active, focus the input */
  isActive: boolean;
};

function ExternalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

/**
 * Text search (keystroke) + semantic search (Enter) with client-side embeddings.
 */
export function Search({ posts, isActive }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [localEmbeddings, setLocalEmbeddings] = useState<Record<string, number[]>>({});
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticResults, setSemanticResults] = useState<Post[] | null>(null);
  const [lockedSemanticQuery, setLockedSemanticQuery] = useState<string | null>(null);
  const [indexProgress, setIndexProgress] = useState<{ done: number; total: number } | null>(null);
  const [indexFlash, setIndexFlash] = useState(false);

  const mergedPosts = useMemo(
    () => posts.map((p) => ({ ...p, embedding: p.embedding?.length ? p.embedding : localEmbeddings[p.id] })),
    [posts, localEmbeddings],
  );

  useEffect(() => {
    if (isActive) inputRef.current?.focus();
  }, [isActive]);

  // Leaving the locked semantic query (typing) drops back to text mode.
  useEffect(() => {
    const t = query.trim();
    if (lockedSemanticQuery !== null && t !== lockedSemanticQuery) {
      setLockedSemanticQuery(null);
      setSemanticResults(null);
    }
  }, [query, lockedSemanticQuery]);

  // Backfill embeddings in batches of 5 (browser-only; not sent to Convex).
  useEffect(() => {
    let cancelled = false;
    const embedded = new Set<string>();

    async function backfill() {
      const initialMissing = posts.filter((p) => !p.embedding?.length);
      if (initialMissing.length === 0) return;

      setIndexProgress({ done: 0, total: initialMissing.length });
      let done = 0;

      while (!cancelled) {
        const batch = posts.filter((p) => !p.embedding?.length && !embedded.has(p.id)).slice(0, BACKFILL_BATCH);
        if (batch.length === 0) break;

        const updates: Record<string, number[]> = {};
        for (const p of batch) {
          if (cancelled) return;
          try {
            const vec = await embedText(p.postText);
            updates[p.id] = vec;
            embedded.add(p.id);
          } catch {
            embedded.add(p.id);
          }
          done += 1;
          setIndexProgress({ done, total: initialMissing.length });
        }
        if (Object.keys(updates).length) {
          setLocalEmbeddings((prev) => ({ ...prev, ...updates }));
        }
        await new Promise((r) => setTimeout(r, 150));
      }

      if (cancelled) return;
      setIndexProgress(null);
      if (initialMissing.length > 0) {
        setIndexFlash(true);
        setTimeout(() => setIndexFlash(false), 2000);
      }
    }

    void backfill();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when server posts list identity changes
  }, [posts]);

  const textResults = useMemo(() => searchPosts(query, mergedPosts), [query, mergedPosts]);

  const showSemantic =
    lockedSemanticQuery !== null &&
    query.trim() === lockedSemanticQuery &&
    semanticResults !== null &&
    !semanticLoading;

  const displayPosts: Post[] = showSemantic ? semanticResults : textResults.map((r) => r.item);

  const onSearchKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      const t = query.trim();
      if (!t) return;
      e.preventDefault();
      setSemanticLoading(true);
      setSemanticResults(null);
      try {
        const qEmb = await embedText(t);
        const ranked = mergedPosts
          .filter((p) => Array.isArray(p.embedding) && p.embedding.length > 0)
          .map((p) => ({
            post: p,
            score: cosineSimilarity(qEmb, p.embedding as number[]),
          }))
          .filter((x) => x.score >= SEMANTIC_THRESHOLD)
          .sort((a, b) => b.score - a.score)
          .slice(0, SEMANTIC_TOP)
          .map((x) => x.post);
        setSemanticResults(ranked);
        setLockedSemanticQuery(t);
      } finally {
        setSemanticLoading(false);
      }
    },
    [query, mergedPosts],
  );

  const modeLine = (() => {
    if (indexProgress) {
      return `Indexing posts for AI search… ${indexProgress.done} of ${indexProgress.total}`;
    }
    if (indexFlash) return "AI search ready";
    if (semanticLoading) return "Searching by meaning…";
    if (showSemantic) {
      return (
        <span>
          Semantic search
          <span className="ai-badge">AI</span>
        </span>
      );
    }
    const t = query.trim();
    if (t) return "Text search";
    return `Showing all ${mergedPosts.length} posts`;
  })();

  if (posts.length === 0) {
    return (
      <div className="search-empty">
        <p className="search-empty-title">No posts synced yet</p>
        <p className="search-empty-sub">Install the SavedIn extension to import your LinkedIn saves</p>
        <a className="search-empty-link" href="#" target="_blank" rel="noreferrer">
          Chrome Web Store
        </a>
        <style>{searchStyles}</style>
      </div>
    );
  }

  const noResults = displayPosts.length === 0 && query.trim().length > 0;

  return (
    <div className="search-root">
      <input
        ref={inputRef}
        className="search-input"
        type="search"
        placeholder="Search your saved posts..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onSearchKeyDown}
        autoComplete="off"
      />
      <div className="search-mode">{modeLine}</div>

      {noResults ? (
        <div className="search-empty-results">
          <p className="search-empty-title">No posts found</p>
          <p className="search-empty-sub">Try a different search term</p>
        </div>
      ) : (
        <ul className="search-list">
          {displayPosts.map((post) => {
            const sr = textResults.find((r) => r.item.id === post.id);
            const ranges = showSemantic ? [] : sr?.ranges ?? [];
            const previewHtml = showSemantic
              ? escapeHtml(post.postText.slice(0, 400)) + (post.postText.length > 400 ? "…" : "")
              : buildHighlightedPreview(post.postText, ranges);

            return (
              <li key={post.id} className="search-card">
                <a
                  className="search-card-link"
                  href={post.postUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open post"
                  aria-label="Open post"
                >
                  <ExternalIcon />
                </a>
                <div className="search-card-head">
                  <span className="search-author">{escapeText(post.authorName)}</span>
                  {showSemantic ? <span className="pill-ai">AI match</span> : null}
                </div>
                <div className="search-headline">{escapeText(post.authorHeadline)}</div>
                <div className="search-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </li>
            );
          })}
        </ul>
      )}
      <style>{searchStyles}</style>
    </div>
  );
}

function escapeText(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(s: string) {
  return escapeText(s).replace(/"/g, "&quot;");
}

const searchStyles = `
  .search-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    padding: 24px 28px;
  }
  .search-input {
    width: 100%;
    font-size: 15px;
    padding: 12px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--border-input);
    background: var(--surface);
    color: var(--text);
    outline: none;
  }
  .search-input:focus {
    border-color: var(--accent);
  }
  .search-mode {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 8px;
    min-height: 18px;
  }
  .search-list {
    list-style: none;
    margin: 20px 0 0;
    padding: 0;
    overflow: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .search-card {
    position: relative;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 40px 14px 14px;
  }
  .search-card-link {
    position: absolute;
    top: 12px;
    right: 12px;
    color: var(--text-muted);
    display: flex;
    padding: 4px;
    border-radius: var(--radius-sm);
  }
  .search-card-link:hover {
    color: var(--accent);
    background: var(--surface-hover);
  }
  .search-card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .search-author {
    font-weight: 600;
    font-size: 14px;
  }
  .search-headline {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 2px;
    margin-bottom: 8px;
  }
  .search-preview {
    font-size: 13px;
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 5;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .search-empty,
  .search-empty-results {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 48px 24px;
    min-height: 200px;
  }
  .search-empty-title {
    font-size: 18px;
    font-weight: 600;
    margin: 0 0 8px;
  }
  .search-empty-sub {
    color: var(--text-muted);
    font-size: 14px;
    margin: 0 0 16px;
    max-width: 360px;
  }
  .search-empty-link {
    font-size: 14px;
    font-weight: 500;
  }
`;
