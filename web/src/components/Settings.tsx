import type { Settings } from "@savedin/shared";
import { useEffect, useState } from "react";

const STORAGE_KEY = "savedin_settings";
const HARDCODED_MODEL = "gemini-2.0-flash-exp";

export function loadSavedinSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { apiKey: "", model: HARDCODED_MODEL };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      model: HARDCODED_MODEL,
    };
  } catch {
    return { apiKey: "", model: HARDCODED_MODEL };
  }
}

type Props = {
  /** Whether the settings block is expanded */
  expanded: boolean;
  onToggle: () => void;
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
};

/**
 * Collapsible sidebar settings: Gemini API key stored only in localStorage.
 */
export function Settings({ expanded, onToggle, settings, onSettingsChange }: Props) {
  const [draftKey, setDraftKey] = useState(settings.apiKey);

  useEffect(() => {
    setDraftKey(settings.apiKey);
  }, [settings.apiKey]);

  function save() {
    const next: Settings = {
      apiKey: draftKey.trim(),
      model: HARDCODED_MODEL,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    onSettingsChange(next);
  }

  return (
    <div className="settings-block">
      <button type="button" className="settings-toggle" onClick={onToggle} aria-expanded={expanded}>
        <GearIcon />
        <span>Settings</span>
      </button>
      {expanded ? (
        <div className="settings-body">
          <label className="settings-label" htmlFor="savedin-gemini-key">
            Gemini API key
          </label>
          <input
            id="savedin-gemini-key"
            className="settings-input"
            type="password"
            autoComplete="off"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            placeholder="Paste API key"
          />
          <button type="button" className="settings-save" onClick={save}>
            Save
          </button>
          <p className="settings-help">
            Free key at{" "}
            <a href="https://aistudio.google.com" target="_blank" rel="noreferrer">
              aistudio.google.com
            </a>
            . Stored only in your browser.
          </p>
        </div>
      ) : null}

      <style>{`
        .settings-block {
          border-top: 1px solid var(--border);
          padding-top: 12px;
          margin-top: 8px;
        }
        .settings-toggle {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 10px;
          border-radius: var(--radius-sm);
          border: none;
          background: transparent;
          color: var(--text-muted);
          font-size: 13px;
          text-align: left;
        }
        .settings-toggle:hover {
          background: var(--surface-hover);
          color: var(--text);
        }
        .settings-body {
          padding: 10px 4px 4px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .settings-label {
          font-size: 11px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .settings-input {
          width: 100%;
          padding: 8px 10px;
          font-size: 13px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-input);
          background: var(--bg);
          color: var(--text);
          outline: none;
        }
        .settings-input:focus {
          border-color: var(--accent);
        }
        .settings-save {
          align-self: flex-start;
          padding: 6px 14px;
          font-size: 13px;
          font-weight: 600;
          border-radius: var(--radius-sm);
          border: none;
          background: var(--accent);
          color: #fff;
        }
        .settings-help {
          margin: 4px 0 0;
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.45;
        }
      `}</style>
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}
