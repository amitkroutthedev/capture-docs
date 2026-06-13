import { useNavigate, useSearchParams } from "react-router-dom";
import { AiProviderForm } from "../components/AiProviderForm";
import { canTranscribe } from "../ai";

export function Settings() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // When generation sends the user here for a missing key, ?next=/r/<id>
  // returns them to that recording after a complete save.
  const next = params.get("next");

  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <span className="eyebrow">Settings</span>
      <h1 style={{ fontSize: 26, margin: "8px 0 16px" }}>AI providers</h1>

      {next && (
        <p className="warn" style={{ marginBottom: 16 }}>
          Add a key for your selected providers, then you'll be sent back to
          generate subtitles for your recording.
        </p>
      )}

      <div className="panel">
        <p className="hint" style={{ marginBottom: 18 }}>
          CaptureDocs calls your chosen transcription and chapter providers
          directly from the browser using these keys. They're stored in this
          browser's localStorage only and sent only to the provider you pick.
          localStorage is readable by any script on the page (an extension, a
          compromised dependency), so use revocable, low-limit keys here. A
          deployed version would keep keys server-side and never expose them to
          the browser.
        </p>
        <AiProviderForm
          saveLabel="Save settings"
          onSaved={(s) => {
            if (next && canTranscribe(s)) navigate(next);
          }}
        />
      </div>

      <p className="hint" style={{ marginTop: 14 }}>
        Upload limits are per provider: OpenAI and Groq Whisper accept up to
        25 MB (~3–4 min at 1080p); Deepgram takes much larger files. Longer
        recordings need the server-side pipeline.
      </p>
    </div>
  );
}
