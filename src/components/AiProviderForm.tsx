import { useState } from "react";
import {
  CHAPTER_PROVIDERS,
  canTranscribe,
  getAiSettings,
  setAiSettings,
  TRANSCRIPTION_PROVIDERS,
  type AiSettings,
  type ChapterProviderId,
  type TranscriptionProviderId,
} from "../ai";

function KeyField({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-clear">
        <input
          id={id}
          type="password"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value.trim())}
        />
        {value && (
          <button
            type="button"
            className="clear-btn"
            aria-label={`Clear ${label}`}
            title="Clear"
            onClick={() => onChange("")}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Controlled-on-mount, save-on-submit form for AI provider keys.
 * Transcription key is required; the chapter key is optional — leaving it
 * empty means chapters/summary are skipped at generation time.
 */
export function AiProviderForm({
  onSaved,
  saveLabel = "Save settings",
}: {
  onSaved?: (settings: AiSettings) => void;
  saveLabel?: string;
}) {
  const [draft, setDraft] = useState<AiSettings>(getAiSettings);
  const [saved, setSaved] = useState(false);

  const sameProvider = draft.chapterProvider === draft.transcriptionProvider;

  return (
    <div>
      <span className="eyebrow">Transcription</span>
      <div className="field" style={{ marginTop: 6 }}>
        <label htmlFor="tp">Provider</label>
        <select
          id="tp"
          value={draft.transcriptionProvider}
          onChange={(e) =>
            setDraft({
              ...draft,
              transcriptionProvider: e.target.value as TranscriptionProviderId,
            })
          }
        >
          {Object.entries(TRANSCRIPTION_PROVIDERS).map(([id, p]) => (
            <option key={id} value={id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <KeyField
        id="tk"
        label={`${TRANSCRIPTION_PROVIDERS[draft.transcriptionProvider].label} key`}
        placeholder={TRANSCRIPTION_PROVIDERS[draft.transcriptionProvider].keyHint}
        value={draft.keys[draft.transcriptionProvider] ?? ""}
        onChange={(v) =>
          setDraft({
            ...draft,
            keys: { ...draft.keys, [draft.transcriptionProvider]: v },
          })
        }
      />

      <span className="eyebrow">Chapters &amp; summary</span>
      <div className="field" style={{ marginTop: 6 }}>
        <label htmlFor="cp">Provider</label>
        <select
          id="cp"
          value={draft.chapterProvider}
          onChange={(e) =>
            setDraft({ ...draft, chapterProvider: e.target.value as ChapterProviderId })
          }
        >
          {Object.entries(CHAPTER_PROVIDERS).map(([id, p]) => (
            <option key={id} value={id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      {sameProvider ? (
        <p className="hint" style={{ margin: "4px 0 16px" }}>
          Same platform as transcription — one key covers both, so chapters
          will always be generated.
        </p>
      ) : (
        <>
          <KeyField
            id="ck"
            label={`${CHAPTER_PROVIDERS[draft.chapterProvider].label} key`}
            placeholder={CHAPTER_PROVIDERS[draft.chapterProvider].keyHint}
            value={draft.keys[draft.chapterProvider] ?? ""}
            onChange={(v) =>
              setDraft({
                ...draft,
                keys: { ...draft.keys, [draft.chapterProvider]: v },
              })
            }
          />
          <p className="hint" style={{ margin: "-6px 0 16px" }}>
            Leave empty to skip chapters &amp; summary — transcription still runs.
          </p>
        </>
      )}

      <div className="row" style={{ marginTop: 4 }}>
        <button
          className="btn btn-amber"
          onClick={() => {
            setAiSettings(draft);
            setSaved(true);
            onSaved?.(draft);
          }}
        >
          {saveLabel}
        </button>
        {saved && (
          <span className="hint">
            {canTranscribe(draft)
              ? "Saved."
              : "Saved — add a transcription key to generate."}
          </span>
        )}
      </div>
    </div>
  );
}