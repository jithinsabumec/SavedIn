/**
 * Full-page onboarding when the signed-in user has no posts in Convex yet.
 */
export function Onboarding() {
  return (
    <div className="onboarding">
      <div className="onboarding-inner">
        <div className="onboarding-logo">
          <span className="onboarding-saved">Saved</span>
          <span className="onboarding-in">In</span>
        </div>
        <h1 className="onboarding-h1">Welcome to SavedIn</h1>
        <p className="onboarding-sub">Import your LinkedIn saved posts to get started.</p>

        <ol className="onboarding-steps">
          <li className="onboarding-step">
            <div className="onboarding-step-title">Step 1: Install the extension</div>
            <a className="onboarding-btn" href="#" target="_blank" rel="noreferrer">
              Add to Chrome
            </a>
          </li>
          <li className="onboarding-step">
            <div className="onboarding-step-title">Step 2: Sync your posts</div>
            <p className="onboarding-step-text">
              Open LinkedIn saved posts and click the sync button in the SavedIn extension.
            </p>
            <a
              className="onboarding-link"
              href="https://www.linkedin.com/my-items/saved-posts/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Go to LinkedIn saved posts →
            </a>
          </li>
        </ol>
      </div>
      <style>{`
        .onboarding {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 24px;
          overflow: auto;
        }
        .onboarding-inner {
          max-width: 440px;
          width: 100%;
          text-align: center;
        }
        .onboarding-logo {
          font-size: 2rem;
          font-weight: 700;
          margin-bottom: 20px;
        }
        .onboarding-saved {
          color: var(--text);
        }
        .onboarding-in {
          color: var(--accent);
        }
        .onboarding-h1 {
          font-size: 1.5rem;
          font-weight: 600;
          margin: 0 0 8px;
        }
        .onboarding-sub {
          color: var(--text-muted);
          margin: 0 0 32px;
          font-size: 15px;
        }
        .onboarding-steps {
          text-align: left;
          margin: 0;
          padding: 0;
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 28px;
        }
        .onboarding-step {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 18px 20px;
        }
        .onboarding-step-title {
          font-weight: 600;
          margin-bottom: 12px;
          font-size: 14px;
        }
        .onboarding-step-text {
          color: var(--text-muted);
          font-size: 13px;
          line-height: 1.5;
          margin: 0 0 12px;
        }
        .onboarding-btn {
          display: inline-block;
          padding: 10px 18px;
          background: var(--accent);
          color: #fff !important;
          font-weight: 600;
          font-size: 14px;
          border-radius: var(--radius);
          text-decoration: none !important;
        }
        .onboarding-btn:hover {
          filter: brightness(1.08);
        }
        .onboarding-link {
          font-size: 14px;
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}
