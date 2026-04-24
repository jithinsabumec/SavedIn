import { SignOutButton, useAuth, useUser } from "@clerk/clerk-react";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Post, Settings } from "@savedin/shared";
import { Chat } from "./components/Chat";
import { Search } from "./components/Search";
import { loadSavedinSettings, Settings as SettingsPanel } from "./components/Settings";
import { Landing } from "./pages/Landing";
import { Onboarding } from "./pages/Onboarding";
import type { ConvexPostRow } from "./utils/mapConvexPosts";
import { mapConvexPostsToPosts } from "./utils/mapConvexPosts";

type MainView = "onboarding" | "search" | "chat";

/**
 * After web sign-in, hand the Convex-compatible Clerk JWT to the extension (externally_connectable).
 */
function ExtensionAuthSync({
  email,
  getToken,
  userId,
}: {
  email: string;
  getToken: ReturnType<typeof useAuth>["getToken"];
  userId: string;
}) {
  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get("extension_auth") === "true";
    const fromSession = sessionStorage.getItem("savedin_extension_auth") === "1";
    if (!fromQuery && !fromSession) return;

    const extensionId = import.meta.env.VITE_EXTENSION_ID as string | undefined;
    const chromeApi = (typeof window !== "undefined" && (window as unknown as { chrome?: Chrome }).chrome) || undefined;

    const cleanUrl = () => {
      window.history.replaceState({}, "", window.location.pathname || "/");
    };

    if (!extensionId || !chromeApi?.runtime?.sendMessage) {
      cleanUrl();
      return;
    }

    void (async () => {
      try {
        const token = await getToken({ template: "convex" });
        if (!token) return;

        let tokenExpiresAt: number | undefined;
        try {
          const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
          if (typeof payload.exp === "number") tokenExpiresAt = payload.exp * 1000;
        } catch {
          // ignore — extension can still read exp from the JWT
        }

        chromeApi.runtime.sendMessage(
          extensionId,
          {
            type: "AUTH_SUCCESS",
            token,
            email,
            userId,
            ...(tokenExpiresAt !== undefined ? { tokenExpiresAt } : {}),
          },
          () => {
            void chromeApi.runtime?.lastError;
          },
        );
      } catch {
        // Best-effort only; never block the dashboard
      } finally {
        sessionStorage.removeItem("savedin_extension_auth");
        cleanUrl();
      }
    })();
  }, [email, getToken, userId]);

  return null;
}

/** Minimal `chrome.runtime` typing for the extension auth callback (no @types/chrome dependency). */
type Chrome = {
  runtime: {
    sendMessage: (extensionId: string, message: unknown, responseCallback?: () => void) => void;
    lastError?: { message: string };
  };
};

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export default function App() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const { user } = useUser();
  const upsertUser = useMutation(api.users.upsertUser);

  const rawPosts = useQuery(api.posts.getPosts, userId ? { userId } : "skip");
  const posts: Post[] | undefined = useMemo(() => {
    if (rawPosts === undefined) return undefined;
    return mapConvexPostsToPosts(rawPosts as ConvexPostRow[]);
  }, [rawPosts]);

  const [settings, setSettings] = useState<Settings>(() => loadSavedinSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mainView, setMainView] = useState<MainView>("search");
  const [importToast, setImportToast] = useState(false);
  const prevCount = useRef<number | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;
    const email = user.primaryEmailAddress?.emailAddress ?? "";
    void upsertUser({ clerkId: user.id, email });
  }, [isLoaded, isSignedIn, user, upsertUser]);

  useEffect(() => {
    if (posts === undefined) return;
    const n = posts.length;
    const prev = prevCount.current;
    if (prev !== null && prev === 0 && n > 0) {
      setMainView("search");
      setImportToast(true);
      const t = window.setTimeout(() => setImportToast(false), 4000);
      prevCount.current = n;
      return () => window.clearTimeout(t);
    }
    prevCount.current = n;
    return undefined;
  }, [posts]);

  useEffect(() => {
    if (posts === undefined) return;
    if (posts.length === 0) setMainView("onboarding");
  }, [posts]);

  const onSettingsChange = useCallback((next: Settings) => {
    setSettings(next);
  }, []);

  if (!isLoaded) {
    return (
      <div className="app-loading">
        <div className="skeleton-text" style={{ width: 120, height: 14 }} />
      </div>
    );
  }

  if (!isSignedIn || !userId) {
    return <Landing />;
  }

  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const postCount = posts?.length;
  const inOnboarding = posts !== undefined && posts.length === 0;

  return (
    <div className="app-layout">
      <ExtensionAuthSync email={email} getToken={getToken} userId={userId} />
      <aside className="app-sidebar">
        <div className="sidebar-logo">
          <span className="sidebar-saved">Saved</span>
          <span className="sidebar-in">In</span>
        </div>

        <nav className="sidebar-nav">
          <button
            type="button"
            className={`sidebar-tab ${mainView === "search" ? "active" : ""}`}
            disabled={inOnboarding}
            onClick={() => setMainView("search")}
          >
            <SearchIcon />
            Search
          </button>
          <button
            type="button"
            className={`sidebar-tab ${mainView === "chat" ? "active" : ""}`}
            disabled={inOnboarding}
            onClick={() => setMainView("chat")}
          >
            <ChatIcon />
            Chat
          </button>
        </nav>

        <div className="sidebar-divider" />

        <SettingsPanel
          expanded={settingsOpen}
          onToggle={() => setSettingsOpen((o) => !o)}
          settings={settings}
          onSettingsChange={onSettingsChange}
        />

        <div className="sidebar-spacer" />

        <div className="sidebar-footer">
          {postCount === undefined ? (
            <div className="sidebar-muted">
              <span className="skeleton-text" style={{ width: 72 }} />
            </div>
          ) : (
            <div className="sidebar-muted">
              {postCount} {postCount === 1 ? "post" : "posts"}
            </div>
          )}
          {email ? <div className="sidebar-muted sidebar-email">{email}</div> : null}
          <SignOutButton>
            <button type="button" className="sidebar-signout">
              Sign out
            </button>
          </SignOutButton>
        </div>
      </aside>

      <main className="app-main">
        {importToast ? <div className="import-toast">Posts imported successfully.</div> : null}
        {posts === undefined ? (
          <div className="main-loading">
            <div className="skeleton-text" style={{ width: 200, height: 16 }} />
          </div>
        ) : inOnboarding ? (
          <Onboarding />
        ) : mainView === "search" ? (
          <Search posts={posts} isActive={mainView === "search"} />
        ) : (
          <Chat posts={posts} settings={settings} />
        )}
      </main>

      <style>{`
        .app-loading,
        .main-loading {
          min-height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .app-layout {
          display: flex;
          height: 100%;
          min-height: 100vh;
          background: var(--bg);
        }
        .app-sidebar {
          width: 220px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--border);
          background: var(--surface);
          padding: 20px 14px 16px;
        }
        .sidebar-logo {
          font-size: 1.35rem;
          font-weight: 700;
          letter-spacing: -0.02em;
          margin-bottom: 20px;
          padding-left: 6px;
        }
        .sidebar-saved {
          color: var(--text);
        }
        .sidebar-in {
          color: var(--accent);
        }
        .sidebar-nav {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .sidebar-tab {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border: none;
          border-radius: var(--radius-sm);
          background: transparent;
          color: var(--text-muted);
          font-size: 14px;
          text-align: left;
        }
        .sidebar-tab:hover:not(:disabled) {
          background: var(--surface-hover);
          color: var(--text);
        }
        .sidebar-tab.active {
          background: var(--surface-hover);
          color: var(--text);
        }
        .sidebar-tab:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .sidebar-divider {
          height: 1px;
          background: var(--border);
          margin: 14px 0 4px;
        }
        .sidebar-spacer {
          flex: 1;
        }
        .sidebar-footer {
          padding-top: 12px;
          border-top: 1px solid var(--border);
        }
        .sidebar-muted {
          font-size: 12px;
          color: var(--text-muted);
          margin-bottom: 6px;
          padding-left: 6px;
        }
        .sidebar-email {
          word-break: break-all;
        }
        .sidebar-signout {
          width: 100%;
          margin-top: 8px;
          padding: 8px 10px;
          font-size: 13px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border);
          background: transparent;
          color: var(--text-muted);
        }
        .sidebar-signout:hover {
          color: var(--text);
          border-color: var(--border-input);
        }
        .app-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          position: relative;
        }
        .import-toast {
          position: absolute;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 10;
          padding: 8px 16px;
          font-size: 13px;
          color: var(--text);
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
        }
      `}</style>
    </div>
  );
}
