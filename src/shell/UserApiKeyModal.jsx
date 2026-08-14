import { useState } from "react";

const LS_KEY = "rxt-user-api-key";

export function readUserApiKey() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); }
  catch { return null; }
}

export function writeUserApiKey(val) {
  if (val) localStorage.setItem(LS_KEY, JSON.stringify(val));
  else localStorage.removeItem(LS_KEY);
}

const PROVIDERS = [
  {
    id: "gemini",
    label: "Gemini",
    placeholder: "AIza...",
    hint: "Free tier available. No credit card required for most usage.",
    howTo: "Go to aistudio.google.com → Get API key → Create API key in new project.",
    url: "https://aistudio.google.com/app/apikey",
    urlLabel: "Get Gemini key →",
  },
  {
    id: "openai",
    label: "OpenAI",
    placeholder: "sk-...",
    hint: "Requires a paid account. GPT-4o used for question generation.",
    howTo: "Go to platform.openai.com → API keys → Create new secret key.",
    url: "https://platform.openai.com/api-keys",
    urlLabel: "Get OpenAI key →",
  },
  {
    id: "anthropic",
    label: "Claude",
    placeholder: "sk-ant-...",
    hint: "Requires a paid Anthropic account. claude-3-5-haiku used for generation.",
    howTo: "Go to console.anthropic.com → API keys → Create key.",
    url: "https://console.anthropic.com/settings/keys",
    urlLabel: "Get Claude key →",
    corsNote: "Anthropic's API blocks direct browser calls. Your key will be used via the local bridge if running, otherwise falls back to shared server.",
  },
  {
    id: "kimi",
    label: "Kimi",
    placeholder: "sk-...",
    hint: "Free trial credits available. Fast and cost-effective for long contexts.",
    howTo: "Go to platform.moonshot.cn → API keys → Create new key.",
    url: "https://platform.moonshot.cn/console/api-keys",
    urlLabel: "Get Kimi key →",
  },
];

export function UserApiKeyModal({ onClose }) {
  const existing = readUserApiKey();
  const [provider, setProvider] = useState(existing?.provider ?? "gemini");
  const [key, setKey] = useState(existing?.key ?? "");
  const [saved, setSaved] = useState(false);

  const selectedProvider = PROVIDERS.find((p) => p.id === provider);

  const save = () => {
    const trimmed = key.trim();
    writeUserApiKey(trimmed ? { provider, key: trimmed } : null);
    window.dispatchEvent(new CustomEvent("rxt-user-api-key-changed"));
    setSaved(true);
    setTimeout(onClose, 900);
  };

  const clear = () => {
    writeUserApiKey(null);
    setKey("");
    window.dispatchEvent(new CustomEvent("rxt-user-api-key-changed"));
    setSaved(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI settings"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-14"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-bg p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-text-1">AI settings</h2>
          <button onClick={onClose} className="font-mono text-xs text-text-3 hover:text-text-1">✕</button>
        </div>

        {/* Explanation */}
        <div className="mb-4 rounded-lg border border-border bg-bg-elevated px-3 py-2.5 font-mono text-[12px] text-text-3 leading-relaxed">
          RxTrack uses AI to generate USMLE-style questions and extract lecture objectives.
          By default it runs through a shared server — adding your own key bypasses it so
          your usage doesn't count against shared quotas.
          <br /><br />
          <span className="text-text-2">Your key is stored only on this device. It is never uploaded.</span>
        </div>

        {/* Provider tabs */}
        <div className="mb-3 flex gap-1.5">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => { setProvider(p.id); setKey(existing?.provider === p.id ? (existing?.key ?? "") : ""); }}
              className={[
                "rounded border px-2.5 py-1 font-mono text-[13px] transition-colors",
                provider === p.id
                  ? "border-accent bg-panel text-text-1"
                  : "border-border text-text-3 hover:text-text-2",
              ].join(" ")}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* How to get it */}
        <div className="mb-3 font-mono text-[12px] text-text-3 leading-relaxed">
          <span className="text-text-2">{selectedProvider.howTo}</span>
          <br />
          <span className="text-text-3">{selectedProvider.hint}</span>
          {selectedProvider.corsNote && (
            <>
              <br />
              <span className="text-warn">{selectedProvider.corsNote}</span>
            </>
          )}
        </div>

        {/* Key input */}
        <div className="mb-2 flex gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => { setKey(e.target.value); setSaved(false); }}
            placeholder={selectedProvider.placeholder}
            className="flex-1 rounded border border-border bg-bg-elevated px-2 py-1.5 font-mono text-xs text-text-1 focus:border-border-strong focus:outline-none"
          />
          {existing?.key && (
            <button
              onClick={clear}
              className="rounded border border-border px-2 py-1 font-mono text-[12px] text-text-3 hover:text-warn"
              title="Remove saved key"
            >
              clear
            </button>
          )}
        </div>

        {existing?.key && (
          <div className="mb-3 font-mono text-[12px] text-good">
            ✓ {PROVIDERS.find((p) => p.id === existing.provider)?.label ?? existing.provider} key active
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <a
            href={selectedProvider.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[12px] text-accent hover:underline"
          >
            {selectedProvider.urlLabel}
          </a>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded border border-border px-3 py-1.5 font-mono text-xs text-text-2 hover:text-text-1"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!key.trim()}
              className="rounded bg-accent px-3 py-1.5 font-mono text-xs font-bold text-bg hover:opacity-90 disabled:opacity-40"
            >
              {saved ? "Saved ✓" : "Save key"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
