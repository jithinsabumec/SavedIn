import { buildHighlightedPreview, searchPosts } from '@savedin/shared';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const MODEL_OPTIONS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
];

const sidebarCount    = document.getElementById('sidebarCount');
const sidebarStatus   = document.getElementById('sidebarStatus');
const tabButtons      = Array.from(document.querySelectorAll('.tab-btn'));
const panels          = {
  search: document.getElementById('searchPanel'),
  chat: document.getElementById('chatPanel'),
};
const settingsToggle  = document.getElementById('settingsToggle');
const settingsPanel   = document.getElementById('settingsPanel');
const apiKeyInput     = document.getElementById('apiKeyInput');
const modelSelect     = document.getElementById('modelSelect');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');

const searchInput      = document.getElementById('searchInput');
const resultsCount     = document.getElementById('resultsCount');
const searchModeEl     = document.getElementById('searchMode');
const resultsList      = document.getElementById('resultsList');
const searchEmptyState = document.getElementById('searchEmptyState');

const chatMessages   = document.getElementById('chatMessages');
const chatEmptyState = document.getElementById('chatEmptyState');
const chatForm       = document.getElementById('chatForm');
const chatInput      = document.getElementById('chatInput');
const sendBtn        = document.getElementById('sendBtn');
const clearChatBtn   = document.getElementById('clearChatBtn');

let allPosts            = [];
let settings            = { apiKey: '', model: DEFAULT_MODEL };
let activeTab           = 'search';
let searchMode          = 'text';
let semanticPending     = false;
let chatHistory         = [];
let activeChatPort      = null;
let currentAssistantUi  = null;
let sidebarStatusTimer  = null;

async function init() {
  populateModelSelect();
  [allPosts, settings] = await Promise.all([loadPosts(), loadSettings()]);
  applySettingsToForm();
  updateSidebarCount();
  updateChatAvailability();
  renderSearchResults(searchPosts('', allPosts));
  searchModeEl.textContent = 'Text search';
  searchInput.focus();

  if (allPosts.length > 0 && allPosts.some((post) => !post.embedding)) {
    chrome.runtime.sendMessage({ type: 'GENERATE_EMBEDDINGS_FOR_EXISTING' }).catch(() => {});
  }
}

function populateModelSelect() {
  modelSelect.innerHTML = MODEL_OPTIONS.map((option) => (
    `<option value="${option.value}">${option.label}</option>`
  )).join('');
}

async function loadPosts() {
  return new Promise((resolve) => {
    chrome.storage.local.get('posts', (data) => {
      const posts = data.posts ?? [];
      posts.sort((a, b) => new Date(b.syncedAt) - new Date(a.syncedAt));
      resolve(posts);
    });
  });
}

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('settings', (data) => {
      const stored = data.settings ?? {};
      resolve({
        apiKey: stored.apiKey ?? '',
        model: stored.model ?? DEFAULT_MODEL,
      });
    });
  });
}

function applySettingsToForm() {
  apiKeyInput.value   = settings.apiKey ?? '';
  modelSelect.value   = settings.model ?? DEFAULT_MODEL;
}

function updateSidebarCount() {
  sidebarCount.textContent = `${allPosts.length} post${allPosts.length !== 1 ? 's' : ''} synced`;
}

function setSidebarStatus(text, persist = false) {
  sidebarStatus.textContent = text;
  if (sidebarStatusTimer) clearTimeout(sidebarStatusTimer);
  if (text && !persist) {
    sidebarStatusTimer = setTimeout(() => {
      sidebarStatus.textContent = '';
      sidebarStatusTimer = null;
    }, 3000);
  }
}

function switchTab(tabName) {
  activeTab = tabName;
  for (const button of tabButtons) {
    button.classList.toggle('active', button.dataset.tab === tabName);
  }
  for (const [name, panel] of Object.entries(panels)) {
    panel.classList.toggle('active', name === tabName);
  }

  if (tabName === 'search') {
    searchInput.focus();
  } else {
    updateChatAvailability();
    chatInput.focus();
  }
}

tabButtons.forEach((button) => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
});

settingsToggle.addEventListener('click', () => {
  const expanded = settingsToggle.getAttribute('aria-expanded') === 'true';
  settingsToggle.setAttribute('aria-expanded', String(!expanded));
  settingsPanel.hidden = expanded;
});

saveSettingsBtn.addEventListener('click', async () => {
  settings = {
    apiKey: apiKeyInput.value.trim(),
    model: modelSelect.value || DEFAULT_MODEL,
  };

  await chrome.storage.local.set({ settings });
  setSidebarStatus('Settings saved');
  updateChatAvailability();
});

searchInput.addEventListener('input', () => {
  searchMode      = 'text';
  semanticPending = false;
  searchModeEl.textContent = 'Text search';
  renderSearchResults(searchPosts(searchInput.value, allPosts));
});

searchInput.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') return;
  if (semanticPending) return;

  event.preventDefault();

  const query = searchInput.value.trim();
  if (!query) return;

  semanticPending         = true;
  searchMode              = 'semantic';
  searchModeEl.textContent = 'Searching...';

  try {
    const response = await chrome.runtime.sendMessage({ type: 'SEMANTIC_SEARCH', query });

    if (!response?.success) throw new Error(response?.error ?? 'Semantic search failed');

    const items = response.results.map((post) => ({ item: post, ranges: [], semantic: true }));
    renderSearchResults(items);
    searchModeEl.textContent = 'Semantic search';
  } catch (error) {
    console.error('[SavedIn] Semantic search error:', error);
    searchMode = 'text';
    searchModeEl.textContent = 'Text search';
    setSidebarStatus('Semantic search is not ready yet');
  } finally {
    semanticPending = false;
  }
});

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const query = chatInput.value.trim();
  if (!query) return;

  if (!settings.apiKey) {
    switchTab('chat');
    settingsToggle.setAttribute('aria-expanded', 'true');
    settingsPanel.hidden = false;
    setSidebarStatus('Add your Google AI Studio key in settings', true);
    return;
  }

  if (activeChatPort) return;

  hideChatEmptyStateIfNeeded();

  const historyForRequest = chatHistory.slice(-6);
  appendMessage('user', query);
  chatHistory.push({ role: 'user', content: query });
  chatInput.value = '';
  currentAssistantUi = appendAssistantPlaceholder();
  sendBtn.disabled = true;

  const port = chrome.runtime.connect({ name: 'chat' });
  activeChatPort = port;

  port.onMessage.addListener((message) => {
    if (!currentAssistantUi) return;

    if (message.type === 'CHAT_CHUNK') {
      currentAssistantUi.streaming = true;
      currentAssistantUi.text += message.text;
      currentAssistantUi.content.classList.remove('muted');
      currentAssistantUi.content.innerHTML = renderMarkdown(stripCitedPostsLine(currentAssistantUi.text));
      scrollChatToBottom();
      return;
    }

    if (message.type === 'CHAT_DONE') {
      const finalText = message.fullText?.trim() || stripCitedPostsLine(currentAssistantUi.text);
      currentAssistantUi.content.classList.remove('muted');
      currentAssistantUi.content.innerHTML = renderMarkdown(finalText || 'No response received.');
      renderSources(currentAssistantUi.sources, message.citedIds ?? []);
      chatHistory.push({ role: 'assistant', content: finalText || 'No response received.' });
      currentAssistantUi.done = true;
      activeChatPort = null;
      currentAssistantUi = null;
      sendBtn.disabled = false;
      scrollChatToBottom();
      return;
    }

    if (message.type === 'CHAT_ERROR') {
      currentAssistantUi.content.classList.add('muted');
      currentAssistantUi.content.textContent = message.message;
      currentAssistantUi.done = true;
      activeChatPort = null;
      currentAssistantUi = null;
      sendBtn.disabled = false;
      scrollChatToBottom();
    }
  });

  port.onDisconnect.addListener(() => {
    if (currentAssistantUi && !currentAssistantUi.done) {
      currentAssistantUi.content.classList.add('muted');
      currentAssistantUi.content.textContent = 'Response interrupted';
      currentAssistantUi.done = true;
      currentAssistantUi = null;
    }
    activeChatPort = null;
    sendBtn.disabled = false;
    scrollChatToBottom();
  });

  port.postMessage({ query, history: historyForRequest });
});

chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

clearChatBtn.addEventListener('click', () => {
  chatHistory = [];
  if (activeChatPort) {
    activeChatPort.disconnect();
    activeChatPort = null;
  }
  currentAssistantUi = null;
  chatMessages.innerHTML = '';
  chatMessages.appendChild(chatEmptyState);
  updateChatAvailability();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'BACKFILL_PROGRESS') return;

  if (message.done >= message.total) {
    setSidebarStatus('AI search ready');
  } else {
    setSidebarStatus(`Indexing ${message.done} of ${message.total}...`, true);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes.posts) {
    allPosts = (changes.posts.newValue ?? []).slice().sort((a, b) => new Date(b.syncedAt) - new Date(a.syncedAt));
    updateSidebarCount();

    if (searchMode !== 'semantic' || !searchInput.value.trim()) {
      renderSearchResults(searchPosts(searchInput.value, allPosts));
      if (searchMode === 'text') searchModeEl.textContent = 'Text search';
    }
  }

  if (changes.settings) {
    const stored = changes.settings.newValue ?? {};
    settings = {
      apiKey: stored.apiKey ?? '',
      model: stored.model ?? DEFAULT_MODEL,
    };
    applySettingsToForm();
    updateChatAvailability();
  }
});

function updateChatAvailability() {
  const hasApiKey = Boolean(settings.apiKey);
  const hasMessages = chatMessages.querySelector('.message-row');

  chatInput.disabled = !hasApiKey;
  sendBtn.disabled   = !hasApiKey || Boolean(activeChatPort);
  chatEmptyState.hidden = hasApiKey || Boolean(hasMessages);
}

function hideChatEmptyStateIfNeeded() {
  chatEmptyState.hidden = true;
}

function appendMessage(role, text) {
  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  row.innerHTML = `
    <div class="message-stack">
      <div class="message-bubble">${escapeHtml(text)}</div>
    </div>
  `;
  chatMessages.appendChild(row);
  scrollChatToBottom();
}

function appendAssistantPlaceholder() {
  const row = document.createElement('div');
  row.className = 'message-row assistant';

  const stack = document.createElement('div');
  stack.className = 'message-stack';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble muted';

  const content = document.createElement('div');
  content.innerHTML = `
    <div class="typing-indicator" aria-label="Assistant is typing">
      <span></span>
      <span></span>
      <span></span>
    </div>
  `;

  const sources = document.createElement('div');

  bubble.appendChild(content);
  stack.appendChild(bubble);
  stack.appendChild(sources);
  row.appendChild(stack);
  chatMessages.appendChild(row);
  scrollChatToBottom();

  return {
    row,
    bubble,
    content,
    sources,
    text: '',
    done: false,
    streaming: false,
  };
}

function renderSources(container, citedIds) {
  container.innerHTML = '';

  const posts = citedIds
    .map((id) => allPosts.find((post) => post.id === id))
    .filter(Boolean);

  if (posts.length === 0) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'sources';

  const label = document.createElement('p');
  label.className = 'sources-label';
  label.textContent = 'Sources';
  wrapper.appendChild(label);

  for (const post of posts) {
    const card = document.createElement('div');
    card.className = 'source-card';
    card.innerHTML = `
      <span class="source-author">${escapeHtml(post.authorName)}</span>
      <div class="source-preview">${escapeHtml(truncateText(post.postText, 80))}</div>
      <a
        class="source-link-icon"
        href="${escapeHtml(post.postUrl)}"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open source post"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 3h7v7"/>
          <path d="M10 14 21 3"/>
          <path d="M21 14v7h-7"/>
          <path d="M3 10v11h11"/>
        </svg>
      </a>
    `;
    wrapper.appendChild(card);
  }

  container.appendChild(wrapper);
}

function renderSearchResults(items) {
  resultsList.querySelectorAll('.result-card').forEach((card) => card.remove());

  const query    = searchInput.value.trim();
  const count    = items.length;
  const isSearch = query.length > 0;

  resultsCount.textContent = isSearch
    ? `${count} result${count !== 1 ? 's' : ''}`
    : `${allPosts.length} post${allPosts.length !== 1 ? 's' : ''}`;

  searchEmptyState.hidden = count !== 0;

  if (count === 0) {
    const emptyTitle = searchEmptyState.querySelector('.empty-title');
    const emptyCopy  = searchEmptyState.querySelector('.empty-copy');
    emptyTitle.textContent = allPosts.length === 0 ? 'No posts synced yet' : 'No posts found';
    emptyCopy.textContent  = allPosts.length === 0
      ? 'Sync your LinkedIn saved posts from the popup first.'
      : 'Try a different search term.';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const { item: post, ranges, semantic } of items) {
    const card = document.createElement('article');
    card.className = 'result-card';

    const preview = buildHighlightedPreview(post.postText, ranges);

    card.innerHTML = `
      <div class="result-card-header">
        <div class="author-block">
          <span class="author-name">${escapeHtml(post.authorName)}</span>
          ${post.authorHeadline ? `<div class="author-headline">${escapeHtml(post.authorHeadline)}</div>` : ''}
        </div>
        <div class="result-card-actions">
          ${semantic ? '<span class="ai-match">AI match</span>' : ''}
          <a class="open-link" href="${escapeHtml(post.postUrl)}" target="_blank" rel="noopener noreferrer">Open post</a>
        </div>
      </div>
      <div class="post-preview">${preview}</div>
    `;

    fragment.appendChild(card);
  }

  resultsList.appendChild(fragment);
}

function stripCitedPostsLine(text) {
  return text.replace(/\s*CITED_POSTS:\s*\[[\s\S]*?\]\s*$/i, '').trim();
}

function renderMarkdown(text) {
  const postMap = new Map(allPosts.map(p => [p.id, p.postUrl]));
  const linkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v7h-7"/><path d="M3 10v11h11"/></svg>`;

  function processInline(str) {
    let out = escapeHtml(str);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    out = out.replace(/\(([0-9a-f]{8}(?:,\s*[0-9a-f]{8})*)\)/gi, (match, ids) => {
      const links = ids.split(',').flatMap(id => {
        const url = postMap.get(id.trim());
        if (!url) return [];
        return [`<a class="post-ref-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="Open source post">${linkIcon}</a>`];
      });
      return links.length > 0 ? links.join('') : match;
    });
    // Fallback: replace bare `POST_ID: hexId` labels with a link icon
    out = out.replace(/POST_ID:\s*([0-9a-f]{8})/gi, (match, id) => {
      const url = postMap.get(id);
      if (!url) return match;
      return `<a class="post-ref-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="Open source post">${linkIcon}</a>`;
    });
    return out;
  }

  const lines = text.split('\n');
  const parts = [];
  let ulOpen = false;
  let olOpen = false;

  const closeLists = () => {
    if (ulOpen) { parts.push('</ul>'); ulOpen = false; }
    if (olOpen) { parts.push('</ol>'); olOpen = false; }
  };

  for (const line of lines) {
    const ulMatch = line.match(/^[*\-]\s+(.+)$/);
    const olMatch = line.match(/^\d+\.\s+(.+)$/);

    if (ulMatch && !/^\*\*/.test(line)) {
      if (olOpen) { parts.push('</ol>'); olOpen = false; }
      if (!ulOpen) { parts.push('<ul>'); ulOpen = true; }
      parts.push(`<li>${processInline(ulMatch[1])}</li>`);
    } else if (olMatch) {
      if (ulOpen) { parts.push('</ul>'); ulOpen = false; }
      if (!olOpen) { parts.push('<ol>'); olOpen = true; }
      parts.push(`<li>${processInline(olMatch[1])}</li>`);
    } else {
      closeLists();
      const trimmed = line.trim();
      if (trimmed) parts.push(`<p>${processInline(trimmed)}</p>`);
    }
  }

  closeLists();
  return parts.join('');
}

function truncateText(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scrollChatToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

init();
