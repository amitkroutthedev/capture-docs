/**
 * AI layer with pluggable providers (spec §4: transcription behind an
 * interface so implementations can be swapped).
 *
 * Transcription: OpenAI Whisper, Groq Whisper (OpenAI-compatible), Deepgram.
 * Chapters/summary LLM: OpenAI, Groq, Anthropic.
 *
 * Dev-mode security note: keys are stored in localStorage and calls are made
 * from the browser. localStorage is readable by any script that runs on the
 * page (XSS, extensions). Fine for a localhost single-user build; in
 * production these calls move to a server-side worker and the browser never
 * holds a key. Browser-direct calls also depend on each provider's CORS
 * policy — another reason the production home is the worker.
 */
import type { Chapter, Segment } from "./types";

// ---------- Settings store ----------

export type TranscriptionProviderId = "openai" | "groq" | "deepgram";
export type ChapterProviderId = "openai" | "groq" | "anthropic";

export interface AiSettings {
  transcriptionProvider: TranscriptionProviderId;
  chapterProvider: ChapterProviderId;
  /** Per-platform API keys. */
  keys: Partial<Record<TranscriptionProviderId | ChapterProviderId, string>>;
}

const SETTINGS_STORAGE = "capturedocs.ai_settings";
const OLD_SETTINGS_STORAGE = "reelnote.ai_settings";
const LEGACY_KEY_STORAGE = "reelnote.openai_key";

export const TRANSCRIPTION_PROVIDERS: Record<
  TranscriptionProviderId,
  { label: string; keyHint: string; maxBytes: number }
> = {
  openai: {
    label: "OpenAI Whisper",
    keyHint: "sk-…",
    maxBytes: 25 * 1024 * 1024,
  },
  groq: {
    label: "Groq Whisper (large-v3-turbo)",
    keyHint: "gsk_…",
    maxBytes: 25 * 1024 * 1024,
  },
  deepgram: {
    label: "Deepgram (nova-2)",
    keyHint: "Deepgram API key",
    maxBytes: 1024 * 1024 * 1024, // accepts large direct uploads
  },
};

export const CHAPTER_PROVIDERS: Record<
  ChapterProviderId,
  { label: string; keyHint: string }
> = {
  openai: { label: "OpenAI (gpt-4o-mini)", keyHint: "sk-…" },
  groq: { label: "Groq (llama-3.3-70b)", keyHint: "gsk_…" },
  anthropic: { label: "Anthropic (Claude Haiku)", keyHint: "sk-ant-…" },
};

export function getAiSettings(): AiSettings {
  const raw =
    localStorage.getItem(SETTINGS_STORAGE) ??
    localStorage.getItem(OLD_SETTINGS_STORAGE);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as AiSettings;
      if (parsed.keys && parsed.transcriptionProvider && parsed.chapterProvider)
        return parsed;
    } catch {
      /* fall through to defaults */
    }
  }
  // Migrate the v0 single-key storage if present.
  const legacy = localStorage.getItem(LEGACY_KEY_STORAGE) ?? "";
  return {
    transcriptionProvider: "openai",
    chapterProvider: "openai",
    keys: legacy ? { openai: legacy } : {},
  };
}

export function setAiSettings(s: AiSettings): void {
  localStorage.setItem(SETTINGS_STORAGE, JSON.stringify(s));
  localStorage.removeItem(LEGACY_KEY_STORAGE);
  localStorage.removeItem(OLD_SETTINGS_STORAGE);
}

export function canTranscribe(s: AiSettings): boolean {
  return !!s.keys[s.transcriptionProvider];
}

export function canGenerateChapters(s: AiSettings): boolean {
  return !!s.keys[s.chapterProvider];
}

// ---------- Transcription ----------

export interface TranscriptionResult {
  segments: Segment[];
  language?: string;
}

export interface TranscriptionProvider {
  maxBytes: number;
  transcribe(file: Blob, filename: string): Promise<TranscriptionResult>;
}

function checkSize(file: Blob, maxBytes: number, providerLabel: string): void {
  if (file.size > maxBytes) {
    throw new Error(
      `Recording is ${(file.size / 1e6).toFixed(0)} MB; ${providerLabel} accepts up to ` +
        `${Math.round(maxBytes / 1e6)} MB from the browser. Larger files need the ` +
        `server-side pipeline (audio extraction), or a provider with a higher limit.`,
    );
  }
}

function toSegments(
  raw: { start: number; end: number; text: string }[],
): Segment[] {
  const segments = raw
    .map((s) => ({
      startMs: Math.round(s.start * 1000),
      endMs: Math.round(s.end * 1000),
      text: s.text.trim(),
    }))
    .filter((s) => s.text.length > 0);
  if (segments.length === 0) {
    throw new Error("No speech detected in the recording's audio track.");
  }
  return segments;
}

/** OpenAI and Groq share the same Whisper-style endpoint shape. */
class WhisperCompatibleProvider implements TranscriptionProvider {
  constructor(
    private apiKey: string,
    private endpoint: string,
    private model: string,
    public maxBytes: number,
    private label: string,
  ) {}

  async transcribe(file: Blob, filename: string): Promise<TranscriptionResult> {
    checkSize(file, this.maxBytes, this.label);
    const form = new FormData();
    form.append("file", file, filename);
    form.append("model", this.model);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`${this.label} transcription failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as {
      language?: string;
      segments?: { start: number; end: number; text: string }[];
    };
    return {
      segments: toSegments(data.segments ?? []),
      language: data.language,
    };
  }
}

class DeepgramProvider implements TranscriptionProvider {
  maxBytes = TRANSCRIPTION_PROVIDERS.deepgram.maxBytes;

  constructor(private apiKey: string) {}

  async transcribe(file: Blob): Promise<TranscriptionResult> {
    checkSize(file, this.maxBytes, "Deepgram");
    const params = new URLSearchParams({
      model: "nova-2",
      smart_format: "true",
      punctuate: "true",
      utterances: "true",
      detect_language: "true",
    });
    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.apiKey}`,
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    if (!res.ok) {
      throw new Error(`Deepgram transcription failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as {
      results?: {
        utterances?: { start: number; end: number; transcript: string }[];
        channels?: { detected_language?: string }[];
      };
    };
    const utterances = data.results?.utterances ?? [];
    return {
      segments: toSegments(
        utterances.map((u) => ({ start: u.start, end: u.end, text: u.transcript })),
      ),
      language: data.results?.channels?.[0]?.detected_language,
    };
  }
}

export function createTranscriptionProvider(
  id: TranscriptionProviderId,
  apiKey: string,
): TranscriptionProvider {
  switch (id) {
    case "openai":
      return new WhisperCompatibleProvider(
        apiKey,
        "https://api.openai.com/v1/audio/transcriptions",
        "whisper-1",
        TRANSCRIPTION_PROVIDERS.openai.maxBytes,
        "OpenAI Whisper",
      );
    case "groq":
      return new WhisperCompatibleProvider(
        apiKey,
        "https://api.groq.com/openai/v1/audio/transcriptions",
        "whisper-large-v3-turbo",
        TRANSCRIPTION_PROVIDERS.groq.maxBytes,
        "Groq Whisper",
      );
    case "deepgram":
      return new DeepgramProvider(apiKey);
  }
}

// ---------- Chapters + summary ----------

export interface ChapterResult {
  chapters: Chapter[];
  summary: string;
}

function chapterPrompt(segments: Segment[], durationMs: number): string {
  const transcript = segments
    .map((s) => `[${Math.round(s.startMs / 1000)}s] ${s.text}`)
    .join("\n");
  return [
    "You segment product-demo transcripts into chapters.",
    "Given the transcript below (each line prefixed with its start time in seconds), return strict JSON only — no markdown fences — with this shape:",
    '{"summary": "1-2 sentence plain description of what this demo covers", "chapters": [{"title": "short title", "startSec": number}]}',
    "Rules: 3 to 8 chapters; the first chapter starts at 0; startSec values must be times that appear in (or fall between) the transcript timestamps, strictly increasing; titles are specific, under 8 words, no numbering.",
    `Total duration: ${Math.round(durationMs / 1000)}s.`,
    "",
    transcript,
  ].join("\n");
}

async function completeOpenAiCompatible(
  endpoint: string,
  apiKey: string,
  model: string,
  prompt: string,
  label: string,
): Promise<string> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`${label} chapter generation failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

async function completeAnthropic(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // Required for browser-direct calls; in production this moves server-side.
      "anthropic-dangerous-direct-browser-access": "true",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic chapter generation failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  return (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

export async function generateChapters(
  provider: ChapterProviderId,
  apiKey: string,
  segments: Segment[],
  durationMs: number,
): Promise<ChapterResult> {
  const prompt = chapterPrompt(segments, durationMs);
  let raw: string;
  switch (provider) {
    case "openai":
      raw = await completeOpenAiCompatible(
        "https://api.openai.com/v1/chat/completions",
        apiKey,
        "gpt-4o-mini",
        prompt,
        "OpenAI",
      );
      break;
    case "groq":
      raw = await completeOpenAiCompatible(
        "https://api.groq.com/openai/v1/chat/completions",
        apiKey,
        "llama-3.3-70b-versatile",
        prompt,
        "Groq",
      );
      break;
    case "anthropic":
      raw = await completeAnthropic(apiKey, prompt);
      break;
  }

  const cleaned = raw.replace(/```json|```/g, "").trim();
  let parsed: { summary?: string; chapters?: { title?: string; startSec?: number }[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Chapter generation returned malformed JSON. Try again.");
  }
  const chapters: Chapter[] = (parsed.chapters ?? [])
    .filter((c) => typeof c.title === "string" && typeof c.startSec === "number")
    .map((c) => ({
      title: c.title!.trim(),
      startMs: Math.max(0, Math.min(Math.round(c.startSec! * 1000), durationMs)),
    }))
    .sort((a, b) => a.startMs - b.startMs);
  if (chapters.length === 0) {
    throw new Error("No chapters could be derived from this transcript.");
  }
  chapters[0].startMs = 0;
  return { chapters, summary: (parsed.summary ?? "").trim() };
}
