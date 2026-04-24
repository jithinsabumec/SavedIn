import type { ChatMessage, Post, Settings } from "@savedin/shared";
import { searchPosts } from "@savedin/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { embedText } from "../lib/embeddingClient";
import { cosineSimilarity } from "../utils/cosineSimilarity";

const GEMINI_MODEL = "gemini-2.0-flash-exp";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`;

type Props = {
  posts: Post[];
  settings: Settings;
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

function buildSystemPrompt(contextPosts: Post[]): string {
  const blocks = contextPosts.map(
    (p) =>
      `POST_ID: ${p.id}
AUTHOR: ${p.authorName}
CONTENT: ${truncate(p.postText, 400)}
---`,
  );
  return `CRITICAL RULE: Never narrate your reasoning. Never write things like 'Let me scan', 'Looking at the posts', 'I notice'. Start your response with the answer immediately.

You are a helpful assistant for a personal LinkedIn saved posts library. Answer questions using only the posts provided. Be conversational and concise. If the answer is not in the posts, say so honestly.

At the end of your response always include:
CITED_POSTS: ["id1","id2"]
listing only post IDs you actually referenced.
If you referenced none write CITED_POSTS: []

Saved posts context:
${blocks.join("\n\n")}
`;
}

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return `${s.slice(0, max).trim()}…`;
}

/** Top 8 posts: text match top 30, re-ranked by embedding similarity when available. */
async function retrieveContextPosts(query: string, posts: Post[]): Promise<Post[]> {
  const textMatches = searchPosts(query, posts)
    .map((r) => r.item)
    .slice(0, 30);
  const qEmb = await embedText(query);
  const scored = textMatches.map((post) => ({
    post,
    score: post.embedding?.length ? cosineSimilarity(qEmb, post.embedding) : -1,
  }));
  scored.sort((a, b) => b.score - a.score);
  const picked: Post[] = [];
  const seen = new Set<string>();
  for (const row of scored) {
    if (row.score >= 0 && picked.length < 8) {
      picked.push(row.post);
      seen.add(row.post.id);
    }
  }
  for (const p of textMatches) {
    if (picked.length >= 8) break;
    if (!seen.has(p.id)) {
      picked.push(p);
      seen.add(p.id);
    }
  }
  return picked.slice(0, 8);
}

function extractGeminiChunkText(json: unknown): string {
  const root = json as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = root?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
}

function stripCitedPostsLine(text: string): string {
  return text.replace(/\s*CITED_POSTS:\s*\[[\s\S]*?\]\s*$/i, "").trim();
}

function parseCitedPostIds(fullText: string): string[] {
  try {
    const match = fullText.match(/CITED_POSTS:\s*(\[[\s\S]*?\])\s*$/i);
    if (!match) return [];
    const parsed: unknown = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is string => typeof id === "string"))];
  } catch {
    return [];
  }
}

async function mapGeminiError(response: Response): Promise<string> {
  if (response.status === 401) return "Invalid API key. Check your settings.";
  if (response.status === 429) return "Rate limit reached. Wait a moment and try again.";
  if (response.status === 403) return "Invalid API key. Check your settings.";
  return "Something went wrong. Please try again.";
}

/**
 * Chat against Gemini with retrieved post context; API key never leaves the browser except to Google.
 */
export function Chat({ posts, settings }: Props) {
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const historyRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    historyRef.current = chatHistory;
  }, [chatHistory]);

  const [streamText, setStreamText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [typing, setTyping] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const clearChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setChatHistory([]);
    setStreamText("");
    setStreaming(false);
    setTyping(false);
    setStreamError(null);
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const query = raw.trim();
      if (!query || streaming || !settings.apiKey) return;

      const priorForModel = historyRef.current.slice(-6);
      setChatHistory((h) => [...h, { role: "user", content: query }]);
      setStreamText("");
      setStreamError(null);
      setStreaming(true);
      setTyping(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const contextPosts = await retrieveContextPosts(query, posts);
        const systemPrompt = buildSystemPrompt(contextPosts);

        const historyContents = priorForModel.map((m) => ({
          role: m.role === "assistant" ? ("model" as const) : ("user" as const),
          parts: [{ text: m.content }],
        }));

        const body = {
          contents: [
            { role: "user" as const, parts: [{ text: systemPrompt }] },
            ...historyContents,
            { role: "user" as const, parts: [{ text: query }] },
          ],
          generationConfig: {
            maxOutputTokens: 4000,
            thinkingConfig: { thinkingBudget: 0 },
          },
        };

        const response = await fetch(`${GEMINI_URL}&key=${encodeURIComponent(settings.apiKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const msg = await mapGeminiError(response);
          setStreamError(msg);
          setStreamText("");
          setTyping(false);
          setStreaming(false);
          setChatHistory((h) => h.slice(0, -1));
          return;
        }

        if (!response.body) {
          setStreamError("Something went wrong. Please try again.");
          setStreamText("");
          setTyping(false);
          setStreaming(false);
          setChatHistory((h) => h.slice(0, -1));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let full = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload) as unknown;
              const chunk = extractGeminiChunkText(json);
              if (!chunk) continue;
              full += chunk;
              setStreamText(full);
              setTyping(false);
            } catch {
              // ignore malformed SSE JSON
            }
          }
        }

        if (buffer.trim().startsWith("data: ")) {
          const payload = buffer.trim().slice(6);
          if (payload !== "[DONE]") {
            try {
              const json = JSON.parse(payload) as unknown;
              const chunk = extractGeminiChunkText(json);
              if (chunk) {
                full += chunk;
                setStreamText(full);
                setTyping(false);
              }
            } catch {
              // ignore
            }
          }
        }

        const citedIds = parseCitedPostIds(full);
        const cleaned = stripCitedPostsLine(full);
        setChatHistory((h) => [...h, { role: "assistant", content: cleaned || full, citedPostIds: citedIds }]);
        setStreamText("");
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setStreamError("Something went wrong. Please try again.");
        setStreamText("");
        setChatHistory((h) => (h.length && h[h.length - 1]?.role === "user" ? h.slice(0, -1) : h));
      } finally {
        setTyping(false);
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [posts, settings.apiKey, streaming],
  );

  if (!settings.apiKey) {
    return (
      <div className="chat-need-key">
        <p className="chat-need-key-title">Add your Gemini API key in settings to use chat</p>
        <p className="chat-need-key-arrow" aria-hidden>
          ←
        </p>
        <style>{chatStyles}</style>
      </div>
    );
  }

  return (
    <div className="chat-root">
      <div className="chat-header">
        <button type="button" className="chat-clear" onClick={clearChat}>
          Clear chat
        </button>
      </div>
      <div className="chat-scroll">
        {chatHistory.map((m, i) => (
          <div key={`${i}-${m.role}`} className={`chat-bubble-wrap ${m.role}`}>
            <div className={`chat-bubble ${m.role}`}>{m.content}</div>
            {m.role === "assistant" && m.citedPostIds?.length ? (
              <div className="chat-sources">
                <div className="chat-sources-label">SOURCES</div>
                {m.citedPostIds
                  .map((id) => posts.find((p) => p.id === id))
                  .filter((p): p is Post => Boolean(p))
                  .map((p) => (
                    <div key={p.id} className="chat-source-card">
                      <div className="chat-source-row">
                        <span className="chat-source-author">{p.authorName}</span>
                        <a
                          className="chat-source-icon"
                          href={p.postUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Open post"
                        >
                          <ExternalIcon />
                        </a>
                      </div>
                      <div className="chat-source-snippet">{truncate(p.postText, 80)}</div>
                    </div>
                  ))}
              </div>
            ) : null}
          </div>
        ))}
        {streamError ? <div className="chat-bubble assistant chat-error">{streamError}</div> : null}
        {(typing || streamText) && (
          <div className="chat-bubble-wrap assistant">
            <div className="chat-bubble assistant">
              {typing && !streamText ? (
                <span className="typing" aria-label="Assistant is typing">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </span>
              ) : (
                stripCitedPostsLine(streamText) || streamText
              )}
            </div>
          </div>
        )}
      </div>
      <ChatComposer onSend={send} disabled={streaming} />
      <style>{chatStyles}</style>
    </div>
  );
}

function ChatComposer({ onSend, disabled }: { onSend: (t: string) => void; disabled: boolean }) {
  const [value, setValue] = useState("");

  return (
    <div className="chat-compose">
      <div className="chat-compose-inner">
        <textarea
          className="chat-textarea"
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!disabled && value.trim()) {
                onSend(value);
                setValue("");
              }
            }
          }}
          placeholder="Ask about your saved posts…"
          disabled={disabled}
        />
        <button
          type="button"
          className="chat-send"
          disabled={disabled || !value.trim()}
          aria-label="Send"
          onClick={() => {
            if (value.trim()) {
              onSend(value);
              setValue("");
            }
          }}
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

const chatStyles = `
  .chat-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .chat-need-key {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 32px;
    text-align: center;
  }
  .chat-need-key-title {
    max-width: 280px;
    font-size: 16px;
    color: var(--text-muted);
    margin: 0;
  }
  .chat-need-key-arrow {
    font-size: 28px;
    color: var(--text-muted);
    margin: 0;
    align-self: flex-start;
    margin-left: 15%;
  }
  .chat-header {
    display: flex;
    justify-content: flex-end;
    padding: 8px 24px 0;
  }
  .chat-clear {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 11px;
    padding: 4px 8px;
  }
  .chat-clear:hover {
    color: var(--text);
  }
  .chat-scroll {
    flex: 1;
    overflow: auto;
    min-height: 0;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .chat-bubble-wrap {
    display: flex;
    flex-direction: column;
    max-width: 100%;
  }
  .chat-bubble-wrap.user {
    align-items: flex-end;
  }
  .chat-bubble-wrap.assistant {
    align-items: flex-start;
  }
  .chat-bubble {
    padding: 10px 14px;
    font-size: 14px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .chat-bubble.user {
    background: rgba(10, 102, 194, 0.15);
    border: 1px solid rgba(10, 102, 194, 0.3);
    border-radius: 16px 16px 4px 16px;
    max-width: 70%;
  }
  .chat-bubble.assistant {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px 16px 16px 4px;
    max-width: 80%;
  }
  .chat-error {
    color: #f87171;
    border-color: rgba(248, 113, 113, 0.35);
  }
  .typing {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    padding: 4px 0;
  }
  .typing-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
    animation: chatfade 1s ease-in-out infinite;
  }
  .typing-dot:nth-child(2) {
    animation-delay: 0.15s;
  }
  .typing-dot:nth-child(3) {
    animation-delay: 0.3s;
  }
  @keyframes chatfade {
    0%, 100% { opacity: 0.25; }
    50% { opacity: 1; }
  }
  .chat-sources {
    margin-top: 8px;
    margin-left: 8px;
    max-width: 80%;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .chat-sources-label {
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .chat-source-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    font-size: 12px;
  }
  .chat-source-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .chat-source-author {
    font-weight: 600;
  }
  .chat-source-icon {
    color: var(--text-muted);
    flex-shrink: 0;
    display: flex;
  }
  .chat-source-icon:hover {
    color: var(--accent);
  }
  .chat-source-snippet {
    color: var(--text-muted);
    line-height: 1.35;
  }
  .chat-compose {
    border-top: 1px solid var(--border);
    padding: 16px 24px;
  }
  .chat-compose-inner {
    position: relative;
  }
  .chat-textarea {
    width: 100%;
    border: none;
    background: transparent;
    resize: none;
    font: inherit;
    color: var(--text);
    padding: 10px 44px 10px 0;
    outline: none;
    min-height: 44px;
  }
  .chat-send {
    position: absolute;
    right: 4px;
    bottom: 6px;
    border: none;
    background: none;
    color: var(--accent);
    padding: 6px;
    display: flex;
    border-radius: var(--radius-sm);
  }
  .chat-send:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
`;
