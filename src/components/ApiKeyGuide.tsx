import { useState } from "react";

interface KeyGuide {
  id: string;
  name: string;
  usedFor: string;
  keyPage: string;
  freeNote: string;
  steps: string[];
}

// Provider key-setup guides. Steps are kept high-level on purpose — dashboard
// labels change, so these point at the canonical key page rather than naming
// buttons that may be renamed. Verified June 2026.
const GUIDES: KeyGuide[] = [
  {
    id: "openai",
    name: "OpenAI",
    usedFor: "Transcription (Whisper) and/or chapters (gpt-4o-mini)",
    keyPage: "https://platform.openai.com/api-keys",
    freeNote: "Paid, pay-as-you-go. Billing must be set up before a key works.",
    steps: [
      "Sign in at platform.openai.com (this is the API platform, separate from ChatGPT).",
      "Under Settings → Billing, add a payment method — a new key returns errors until billing exists.",
      "Open the API keys page and create a new secret key.",
      "Copy it immediately — OpenAI shows the full key only once — then paste it into Settings here.",
    ],
  },
  {
    id: "groq",
    name: "Groq",
    usedFor: "Transcription (Whisper large-v3-turbo) and/or chapters (Llama 3.3 70B)",
    keyPage: "https://console.groq.com/keys",
    freeNote: "Has a free tier — no credit card required to start.",
    steps: [
      "Create an account or sign in at console.groq.com.",
      "Open the API Keys section in the console.",
      "Create a new API key and give it a descriptive name.",
      "Copy it right away (it's shown once), then paste it into Settings here.",
    ],
  },
  {
    id: "deepgram",
    name: "Deepgram",
    usedFor: "Transcription (nova-2) — handles much larger files than the Whisper APIs",
    keyPage: "https://console.deepgram.com/",
    freeNote: "Free signup with starter credit; first key must be made in the Console.",
    steps: [
      "Sign up or sign in at console.deepgram.com.",
      "A first project is created automatically; open the API Keys section.",
      "Create a new API key (your first key has to be made here in the Console).",
      "Copy and store it, then paste it into Settings here.",
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    usedFor: "Chapters & summary (Claude Haiku)",
    keyPage: "https://console.anthropic.com/settings/keys",
    freeNote: "Paid, pay-as-you-go (keys start with sk-ant-). Billing required first.",
    steps: [
      "Sign in at console.anthropic.com (it may redirect to platform.claude.com — same console).",
      "Under Settings → Billing, add a payment method or buy credits.",
      "Open the API Keys section and create a key.",
      "Copy it immediately — shown only once — then paste it into Settings here.",
    ],
  },
];

export function ApiKeyGuide() {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="kg-accordion">
      {GUIDES.map((g) => {
        const isOpen = open === g.id;
        return (
          <div key={g.id} className={`kg-item${isOpen ? " open" : ""}`}>
            <button
              type="button"
              className="kg-head"
              aria-expanded={isOpen}
              aria-controls={`kg-panel-${g.id}`}
              onClick={() => setOpen(isOpen ? null : g.id)}
            >
              <span className="kg-name">{g.name}</span>
              <span className="kg-used">{g.usedFor}</span>
              <span className="kg-chevron" aria-hidden="true">
                {isOpen ? "−" : "+"}
              </span>
            </button>
            {isOpen && (
              <div className="kg-panel" id={`kg-panel-${g.id}`}>
                <p className="hint" style={{ marginTop: 0 }}>
                  {g.freeNote}
                </p>
                <ol className="kg-steps">
                  {g.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
                <a
                  className="btn btn-amber btn-sm"
                  href={g.keyPage}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open {g.name} key page ↗
                </a>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}