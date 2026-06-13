import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  canGenerateChapters,
  canTranscribe,
  createTranscriptionProvider,
  generateChapters,
  getAiSettings,
} from "../ai";
import { getRecording, updateRecording } from "../db";
import { formatTimecode } from "../recorder";
import type { RecordingRecord, WebcamPosition, WebcamShape } from "../types";
import { buildSrt, buildVtt } from "../vtt";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function ext(mime: string): string {
  return mime.includes("mp4") ? "mp4" : "webm";
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i === -1) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

type GenPhase =
  | { state: "idle" }
  | { state: "transcribing" }
  | { state: "chaptering" }
  | { state: "error"; message: string };

export function Playback({ id }: { id: string }) {
  const [rec, setRec] = useState<RecordingRecord | null | undefined>(undefined);
  const [showCaptions, setShowCaptions] = useState(true);
  const [currentMs, setCurrentMs] = useState(0);
  const [query, setQuery] = useState("");
  const [editingSeg, setEditingSeg] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [gen, setGen] = useState<GenPhase>({ state: "idle" });
  const navigate = useNavigate();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const camRef = useRef<HTMLVideoElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getRecording(id).then((r) => setRec(r ?? null));
  }, [id]);

  const videoUrl = useMemo(
    () => (rec ? URL.createObjectURL(rec.blob) : ""),
    [rec?.blob], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const camUrl = useMemo(
    () => (rec?.webcamBlob ? URL.createObjectURL(rec.webcamBlob) : ""),
    [rec?.webcamBlob], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const vttUrl = useMemo(() => {
    if (!rec?.segments?.length) return "";
    return URL.createObjectURL(
      new Blob([buildVtt(rec.segments)], { type: "text/vtt" }),
    );
  }, [rec?.segments]);
  useEffect(
    () => () => {
      for (const u of [videoUrl, camUrl, vttUrl]) if (u) URL.revokeObjectURL(u);
    },
    [videoUrl, camUrl, vttUrl],
  );

  // Captions toggle without re-encoding: flip the text track's mode.
  useEffect(() => {
    const track = videoRef.current?.textTracks[0];
    if (track) track.mode = showCaptions ? "showing" : "hidden";
  }, [showCaptions, vttUrl]);

  // --- Webcam overlay: slave the bubble's clock to the main video.
  // The stored start offset anchors alignment; the periodic resync below is
  // what actually holds long recordings together (drift correction).
  useEffect(() => {
    const main = videoRef.current;
    const cam = camRef.current;
    if (!main || !cam || !camUrl) return;
    const offsetSec = (rec?.webcamOffsetMs ?? 0) / 1000;
    const target = () => Math.max(0, main.currentTime - offsetSec);
    const hardSync = () => {
      cam.currentTime = target();
    };
    const onPlay = () => {
      hardSync();
      cam.play().catch(() => undefined);
    };
    const onPause = () => cam.pause();
    const onRate = () => {
      cam.playbackRate = main.playbackRate;
    };
    main.addEventListener("play", onPlay);
    main.addEventListener("pause", onPause);
    main.addEventListener("seeked", hardSync);
    main.addEventListener("ratechange", onRate);
    const drift = window.setInterval(() => {
      if (main.paused || cam.readyState < 2) return;
      if (Math.abs(cam.currentTime - target()) > 0.15) hardSync();
    }, 1000);
    return () => {
      main.removeEventListener("play", onPlay);
      main.removeEventListener("pause", onPause);
      main.removeEventListener("seeked", hardSync);
      main.removeEventListener("ratechange", onRate);
      clearInterval(drift);
    };
  }, [camUrl, rec?.webcamOffsetMs]);

  useEffect(() => {
    const main = videoRef.current;
    if (!main) return;
    const onTime = () => setCurrentMs(main.currentTime * 1000);
    main.addEventListener("timeupdate", onTime);
    return () => main.removeEventListener("timeupdate", onTime);
  }, [videoUrl]);

  const currentSegIdx = useMemo(() => {
    const segs = rec?.segments;
    if (!segs) return -1;
    return segs.findIndex((s) => currentMs >= s.startMs && currentMs < s.endMs);
  }, [rec?.segments, currentMs]);

  // Keep the spoken line in view (only when not searching).
  useEffect(() => {
    if (query || currentSegIdx < 0) return;
    scrollRef.current
      ?.querySelector(`[data-seg="${currentSegIdx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [currentSegIdx, query]);

  if (rec === undefined) {
    return (
      <div className="status-line">
        <span className="spinner" /> Loading…
      </div>
    );
  }
  if (rec === null) {
    return (
      <div className="empty">
        <h2>Recording not found</h2>
        <p className="hint">It may have been deleted from this browser.</p>
        <a className="btn" href="#/">Back to library</a>
      </div>
    );
  }

  const seek = (ms: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = ms / 1000;
    v.play().catch(() => undefined);
  };

  const patch = async (p: Partial<RecordingRecord>) => {
    const next = await updateRecording(rec.id, p);
    if (next) setRec(next);
  };

async function runGeneration() {
    if (!rec) return;
    const settings = getAiSettings();
    if (!canTranscribe(settings)) {
      navigate(`/settings?next=/r/${rec.id}`);
      return;
    }
    try {
      setGen({ state: "transcribing" });
      const provider = createTranscriptionProvider(
        settings.transcriptionProvider,
        settings.keys[settings.transcriptionProvider]!,
      );
      const { segments, language } = await provider.transcribe(
        rec.blob,
        `recording.${ext(rec.mimeType)}`,
      );

      // Chapters + summary are optional: skip the call when no chapter key is set.
      if (!canGenerateChapters(settings)) {
        await patch({ segments, language, status: "ready", statusError: undefined });
        setGen({ state: "idle" });
        return;
      }

      await patch({ segments, language, status: "chaptering" });
      setGen({ state: "chaptering" });
      const { chapters, summary } = await generateChapters(
        settings.chapterProvider,
        settings.keys[settings.chapterProvider]!,
        segments,
        rec.durationMs || segments[segments.length - 1].endMs,
      );
      await patch({ chapters, summary, status: "ready", statusError: undefined });
      setGen({ state: "idle" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await patch({ status: "failed", statusError: message });
      setGen({ state: "error", message });
    }
  }

  const filteredSegs = rec.segments
    ?.map((s, i) => ({ s, i }))
    .filter(({ s }) => !query || s.text.toLowerCase().includes(query.toLowerCase()));

  const activeChapterIdx =
    rec.chapters?.reduce(
      (acc, c, i) => (currentMs >= c.startMs ? i : acc),
      -1,
    ) ?? -1;

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <input
          aria-label="Recording title"
          defaultValue={rec.title}
          onBlur={(e) => {
            const t = e.target.value.trim();
            if (t && t !== rec.title) patch({ title: t });
          }}
          style={{
            background: "transparent",
            border: "none",
            borderBottom: "1px dashed var(--line)",
            color: "var(--text)",
            fontFamily: "var(--font-display)",
            fontSize: 22,
            fontWeight: 600,
            flex: 1,
            minWidth: 200,
            padding: "0 0 4px",
          }}
        />
        <span className="hint mono">
          {formatTimecode(rec.durationMs)} · {rec.resolution}
        </span>
      </div>

      {rec.summary && (
        <p className="hint" style={{ margin: "0 0 14px", maxWidth: 720 }}>
          <span className="eyebrow" style={{ marginRight: 8 }}>What this demo covers</span>
          {rec.summary}
        </p>
      )}

      <div className="play-layout">
        <div>
          <div className="stage">
            <video ref={videoRef} className="main" src={videoUrl} controls playsInline>
              {vttUrl && (
                <track
                  key={vttUrl}
                  kind="subtitles"
                  label={rec.language ?? "Subtitles"}
                  src={vttUrl}
                  default
                />
              )}
            </video>
            {camUrl && (
              <video
                ref={camRef}
                className={`bubble ${rec.webcamShape} ${rec.webcamPosition}`}
                src={camUrl}
                muted
                playsInline
                aria-label="Webcam overlay"
              />
            )}
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            {rec.segments && (
              <button className="btn btn-sm" onClick={() => setShowCaptions((v) => !v)}>
                Captions: {showCaptions ? "on" : "off"}
              </button>
            )}
            {camUrl && (
              <>
                <select
                  className="btn btn-sm"
                  aria-label="Bubble position"
                  value={rec.webcamPosition}
                  onChange={(e) =>
                    patch({ webcamPosition: e.target.value as WebcamPosition })
                  }
                >
                  <option value="bottom-right">Bubble: bottom right</option>
                  <option value="bottom-left">Bubble: bottom left</option>
                  <option value="top-right">Bubble: top right</option>
                  <option value="top-left">Bubble: top left</option>
                </select>
                <select
                  className="btn btn-sm"
                  aria-label="Bubble shape"
                  value={rec.webcamShape}
                  onChange={(e) => patch({ webcamShape: e.target.value as WebcamShape })}
                >
                  <option value="circle">Circle</option>
                  <option value="rounded">Rounded</option>
                </select>
              </>
            )}
            <span style={{ flex: 1 }} />
            <button
              className="btn btn-sm"
              onClick={() => download(rec.blob, `${rec.title}.${ext(rec.mimeType)}`)}
            >
              Download video
            </button>
            {rec.webcamBlob && (
              <button
                className="btn btn-sm"
                onClick={() =>
                  download(rec.webcamBlob!, `${rec.title} (webcam).${ext(rec.webcamMimeType!)}`)
                }
              >
                Webcam file
              </button>
            )}
            {rec.segments && (
              <>
                <button
                  className="btn btn-sm"
                  onClick={() =>
                    download(
                      new Blob([buildVtt(rec.segments!)], { type: "text/vtt" }),
                      `${rec.title}.vtt`,
                    )
                  }
                >
                  .vtt
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() =>
                    download(
                      new Blob([buildSrt(rec.segments!)], { type: "text/plain" }),
                      `${rec.title}.srt`,
                    )
                  }
                >
                  .srt
                </button>
              </>
            )}
          </div>

          {rec.chapters && rec.chapters.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <span className="eyebrow">Chapters</span>
              <div className="chapter-list">
                {rec.chapters.map((c, i) => (
                  <div
                    key={i}
                    className={`chapter-item ${i === activeChapterIdx ? "active" : ""}`}
                  >
                    <button
                      className="t mono"
                      style={{ background: "none", border: "none", padding: 0 }}
                      onClick={() => seek(c.startMs)}
                      aria-label={`Jump to ${formatTimecode(c.startMs)}`}
                    >
                      {formatTimecode(c.startMs)}
                    </button>
                    <input
                      aria-label={`Chapter ${i + 1} title`}
                      defaultValue={c.title}
                      onBlur={(e) => {
                        const t = e.target.value.trim();
                        if (!t || t === c.title) return;
                        const chapters = rec.chapters!.map((ch, j) =>
                          j === i ? { ...ch, title: t } : ch,
                        );
                        patch({ chapters });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="panel transcript-panel">
          <span className="eyebrow">Transcript</span>

          {!rec.segments && gen.state === "idle" && rec.status !== "failed" && (
            <div style={{ marginTop: 14 }}>
              <p className="hint">
                No subtitles yet. Generation transcribes the audio (Whisper),
                builds toggleable captions, and derives titled chapters.
              </p>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn btn-amber" onClick={runGeneration}>
                  Generate subtitles & chapters
                </button>
                <Link className="btn btn-ghost btn-sm" to="/settings">
                  AI providers…
                </Link>
              </div>
              <p className="hint" style={{ marginTop: 10 }}>
                Keys are managed in Settings. Upload limits depend on the
                provider — OpenAI/Groq Whisper accept up to 25 MB (~3–4 min at
                1080p); Deepgram takes much larger files. Bigger recordings need
                the server-side pipeline.
              </p>
            </div>
          )}

          {(gen.state === "transcribing" || gen.state === "chaptering") && (
            <div className="status-line" style={{ marginTop: 14 }}>
              <span className="spinner" />
              {gen.state === "transcribing"
                ? "Generating subtitles…"
                : "Deriving chapters…"}
            </div>
          )}

          {(gen.state === "error" || (rec.status === "failed" && gen.state === "idle")) && (
            <div style={{ marginTop: 14 }}>
              <p className="error">
                {gen.state === "error" ? gen.message : rec.statusError}
              </p>
              <button className="btn btn-sm" onClick={runGeneration} style={{ marginTop: 8 }}>
                Try again
              </button>
            </div>
          )}

          {rec.segments && (
            <>
              <div className="search">
                <input
                  type="text"
                  placeholder="Search transcript…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search transcript"
                />
              </div>
              <div className="transcript-scroll" ref={scrollRef}>
                {filteredSegs?.length === 0 && (
                  <p className="hint">No lines match “{query}”.</p>
                )}
                {filteredSegs?.map(({ s, i }) => (
                  <div
                    key={i}
                    data-seg={i}
                    className={`seg ${i === currentSegIdx ? "current" : ""}`}
                    onClick={() => editingSeg !== i && seek(s.startMs)}
                  >
                    <span className="t">{formatTimecode(s.startMs)}</span>
                    {editingSeg === i ? (
                      <textarea
                        autoFocus
                        value={draft}
                        rows={2}
                        onChange={(e) => setDraft(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => {
                          const t = draft.trim();
                          setEditingSeg(null);
                          if (!t || t === s.text) return;
                          const segments = rec.segments!.map((seg, j) =>
                            j === i ? { ...seg, text: t } : seg,
                          );
                          patch({ segments }); // VTT re-derives from segments
                        }}
                      />
                    ) : (
                      <span
                        className="x"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingSeg(i);
                          setDraft(s.text);
                        }}
                        title="Double-click to edit"
                      >
                        {highlight(s.text, query)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <p className="hint" style={{ marginTop: 10 }}>
                Click a line to jump. Double-click to edit — edits update the
                captions instantly.
              </p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
