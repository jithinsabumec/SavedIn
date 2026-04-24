import { useSignIn } from "@clerk/clerk-react";
import { useEffect, useState } from "react";

/**
 * Pre-auth screen: magic link sign-in via Clerk (email_link first factor).
 */
export function Landing() {
  const { isLoaded, signIn } = useSignIn();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preserve extension sign-in intent across Clerk magic-link redirects (query params may drop).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("extension_auth") === "true") {
      sessionStorage.setItem("savedin_extension_auth", "1");
    }
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isLoaded || !signIn) return;
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email address.");
      return;
    }

    setBusy(true);
    try {
      await signIn.create({ identifier: trimmed });
      const factors = signIn.supportedFirstFactors ?? [];
      const emailLink = factors.find((f) => f.strategy === "email_link");
      if (!emailLink || emailLink.strategy !== "email_link") {
        setError("Magic link sign-in is not enabled for this application.");
        return;
      }
      await signIn.prepareFirstFactor({
        strategy: "email_link",
        emailAddressId: emailLink.emailAddressId,
        redirectUrl: `${window.location.origin}/`,
      });
      setSent(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not send magic link.";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="landing">
      <div className="landing-inner">
        <div className="landing-logo">
          <span className="landing-logo-saved">Saved</span>
          <span className="landing-logo-in">In</span>
        </div>
        <p className="landing-tagline">Your LinkedIn saves, finally searchable.</p>

        {sent ? (
          <p className="landing-sent">Check your inbox for a magic link.</p>
        ) : (
          <form className="landing-form" onSubmit={onSubmit}>
            <input
              type="email"
              className="landing-input"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              disabled={busy || !isLoaded}
            />
            <button type="submit" className="landing-submit" disabled={busy || !isLoaded}>
              {busy ? "Sending…" : "Send magic link"}
            </button>
            {error ? <p className="landing-error">{error}</p> : null}
          </form>
        )}

        <p className="landing-hint">
          Already have the extension? Your posts will appear automatically.
        </p>
      </div>

      <style>{`
        .landing {
          min-height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px 20px;
          background: var(--bg);
        }
        .landing-inner {
          width: 100%;
          max-width: 400px;
          text-align: center;
        }
        .landing-logo {
          font-size: 2.5rem;
          font-weight: 700;
          letter-spacing: -0.02em;
          margin-bottom: 12px;
        }
        .landing-logo-saved {
          color: var(--text);
        }
        .landing-logo-in {
          color: var(--accent);
        }
        .landing-tagline {
          color: var(--text-muted);
          font-size: 1.05rem;
          margin: 0 0 28px;
        }
        .landing-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .landing-input {
          width: 100%;
          padding: 12px 14px;
          font-size: 15px;
          border-radius: var(--radius);
          border: 1px solid var(--border-input);
          background: var(--surface);
          color: var(--text);
          outline: none;
        }
        .landing-input:focus {
          border-color: var(--accent);
        }
        .landing-submit {
          padding: 12px 16px;
          font-size: 15px;
          font-weight: 600;
          border: none;
          border-radius: var(--radius);
          background: var(--accent);
          color: #fff;
        }
        .landing-submit:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .landing-error {
          color: #f87171;
          font-size: 13px;
          margin: 0;
        }
        .landing-sent {
          color: var(--text);
          font-size: 16px;
          margin: 8px 0 0;
        }
        .landing-hint {
          margin-top: 28px;
          font-size: 12px;
          color: var(--text-muted);
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}
