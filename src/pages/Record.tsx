import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { saveRecording } from "../db";
import {
  browserSupported,
  CaptureSession,
  formatTimecode,
  QUALITY_PRESETS,
  type CaptureOptions,
  type CaptureResult,
} from "../recorder";
import { formatBytes, isQuotaError } from "../storage";
import type { RecordingRecord, WebcamPosition, WebcamShape } from "../types";

type Phase = "setup" | "recording" | "saving";

const POSITIONS: { value: WebcamPosition; label: string }[] = [
  { value: "bottom-right", label: "Bottom right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "top-right", label: "Top right" },
  { value: "top-left", label: "Top left" },
];

export function Record() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("setup");
  const [mic, setMic] = useState(true);
  const [webcam, setWebcam] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [position, setPosition] = useState<WebcamPosition>("bottom-right");
  const [shape, setShape] = useState<WebcamShape>("circle");
  const [quality, setQuality] = useState<keyof typeof QUALITY_PRESETS>("1080p");
  const [fps, setFps] = useState<30 | 60>(30);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /** Set when saving to IndexedDB failed: the capture is held in memory so
   *  the user can still download it instead of losing the take. */
  const [rescue, setRescue] = useState<CaptureResult | null>(null);

  const sessionRef = useRef<CaptureSession | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);

  const supported = browserSupported();

  // Webcam self-view during setup. Stopped before recording starts — both to
  // free the device for the capture session and to avoid an infinite mirror
  // when the user records this app's own tab.
 /* useEffect(() => {
    if (!webcam || phase !== "setup") {
      previewStreamRef.current?.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
      return;
    }
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
      })
      .then(async (stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        previewStreamRef.current = stream;
        if (previewRef.current) previewRef.current.srcObject = stream;
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices(all.filter((d) => d.kind === "videoinput"));
      })
      .catch(() => {
        setNotice("Camera permission was blocked — recording will continue without the face bubble.");
        setWebcam(false);
      });
    return () => {
      cancelled = true;
      previewStreamRef.current?.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
    };
  }, [webcam, deviceId, phase]);*/

   useEffect(() => {
    if (previewRef.current && previewStreamRef.current) {
      previewRef.current.srcObject = previewStreamRef.current;
    }
  }, [position, webcam, phase]);

  // Don't leave a live session behind if the component unmounts mid-recording.
  useEffect(() => () => sessionRef.current?.abort(), []);

  async function start() {
    setError("");
    setNotice("");
    const opts: CaptureOptions = {
      quality,
      frameRate: fps,
      mic,
      webcam,
      webcamDeviceId: deviceId || undefined,
    };
    const session = new CaptureSession(opts, {
      onTick: setElapsed,
      onSurfaceEnded: () => finish(), // native "Stop sharing" button
    });
    sessionRef.current = session;

    // Release the preview camera before the session claims it.
    previewStreamRef.current?.getTracks().forEach((t) => t.stop());
    previewStreamRef.current = null;

    try {
      const { micDenied, camDenied } = await session.acquire();
      const partial: string[] = [];
      if (micDenied) partial.push("microphone blocked — no narration audio");
      if (camDenied) partial.push("camera blocked — no face bubble");
      if (partial.length > 0) setNotice(`Recording without: ${partial.join("; ")}.`);
      session.start();
      setPaused(false);
      setElapsed(0);
      setPhase("recording");
    } catch (e) {
      session.abort();
      sessionRef.current = null;
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Screen capture was cancelled. Pick a tab, window, or screen to record."
          : `Could not start recording: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async function finish() {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    setPhase("saving");
    let result: CaptureResult | null = null;
    try {
      result = await session.stop();
      const id = crypto.randomUUID();
      const rec: RecordingRecord = {
        id,
        title: `Recording ${new Date().toLocaleString()}`,
        createdAt: Date.now(),
        durationMs: result.durationMs,
        mimeType: result.mimeType,
        resolution: result.resolution,
        blob: result.screenBlob,
        webcamBlob: result.webcamBlob,
        webcamMimeType: result.webcamMimeType,
        webcamOffsetMs: result.webcamOffsetMs,
        webcamPosition: position,
        webcamShape: shape,
        status: "ready",
      };
      await saveRecording(rec);
      navigate(`/r/${id}`);
    } catch (e) {
      if (result) {
        // The capture itself succeeded — never drop it because storage is full.
        setRescue(result);
        setError(
          isQuotaError(e)
            ? `Browser storage is full — the recording (${formatBytes(result.screenBlob.size)}) could not be saved to the library. Download it below, then free space by deleting old recordings.`
            : `Saving to the library failed (${e instanceof Error ? e.message : String(e)}). Download the recording below so it isn't lost.`,
        );
      } else {
        setError(`Recording failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      setPhase("setup");
    }
  }

  if (!supported) {
    return (
      <div className="panel">
        <h2>This browser can't record</h2>
        <p className="hint" style={{ marginTop: 10 }}>
          CaptureDocs needs <code>getDisplayMedia</code> and{" "}
          <code>MediaRecorder</code>. Safari and Firefox support them only
          partially — use a Chromium browser (Chrome, Edge, Arc, Brave) to
          record. Playback works everywhere.
        </p>
      </div>
    );
  }

  if (phase !== "setup") {
    return (
      <div>
        <div className="controlbar" role="group" aria-label="Recording controls">
          <span className={`rec-pill ${paused ? "paused" : ""}`}>
            <span className="lamp" /> {paused ? "PAUSED" : "REC"}
          </span>
          <span className="timecode" aria-live="off">
            {formatTimecode(elapsed)}
          </span>
          <button
            className="btn"
            onClick={() => {
              const s = sessionRef.current;
              if (!s) return;
              if (s.paused) s.resume();
              else s.pause();
              setPaused(s.paused);
            }}
            disabled={phase === "saving"}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button className="btn btn-rec" onClick={finish} disabled={phase === "saving"}>
            {phase === "saving" ? "Saving…" : "Stop"}
          </button>
        </div>
        <p className="hint" style={{ textAlign: "center" }}>
          Recording continues if you switch tabs. The browser's own
          "Stop sharing" button also ends the recording cleanly.
        </p>
        {notice && (
          <p className="warn" style={{ maxWidth: 520, margin: "16px auto" }}>
            {notice}
          </p>
        )}
      </div>
    );
  }

  const preset = QUALITY_PRESETS[quality];
  const showPerfWarning = preset.warn || fps === 60;

  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <span className="eyebrow">New recording</span>
      <h1 style={{ fontSize: 26, margin: "8px 0 18px" }}>
        Pick what to capture
      </h1>
      <div className="panel">
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="q">Resolution</label>
            <select id="q" value={quality} onChange={(e) => setQuality(e.target.value)}>
              {Object.keys(QUALITY_PRESETS).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="f">Frame rate</label>
            <select
              id="f"
              value={fps}
              onChange={(e) => setFps(Number(e.target.value) as 30 | 60)}
            >
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </div>
        </div>
        {showPerfWarning && (
          <p className="warn" style={{ marginBottom: 14 }}>
            Browser recording is software-encoded. At{" "}
            {preset.warn ? "4K" : "60 fps"} the browser may drop frames on
            slower machines — that's a platform limit, not a setting.
          </p>
        )}

        <label className="toggle">
          <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} />
          <span>
            Microphone narration
            <div className="hint">Mixed with tab/system audio into one track</div>
          </span>
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={webcam}
            onChange={(e) => setWebcam(e.target.checked)}
          />
          <span>
            Webcam bubble
            <div className="hint">Recorded as a separate stream, overlaid on playback</div>
          </span>
        </label>

       {webcam && (
          <div style={{ paddingLeft: 26 }}>
            {devices.length > 0 && (
              <div className="field">
                <label htmlFor="cam">Camera</label>
                <select
                  id="cam"
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                >
                  <option value="">Default camera</option>
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || "Camera"}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="field">
              <label>Bubble placement — tap a corner</label>
              <div className="placement-frame" role="group" aria-label="Bubble position">
                <span className="placement-hint mono">your screen</span>
                {POSITIONS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    className={`placement-corner ${p.value}${
                      position === p.value ? " active" : ""
                    }`}
                    aria-label={p.label}
                    aria-pressed={position === p.value}
                    onClick={() => setPosition(p.value)}
                  >
                    {position === p.value ? (
                      <video
                        ref={previewRef}
                        className={`placement-bubble ${shape}`}
                        autoPlay
                        muted
                        playsInline
                      />
                    ) : (
                      <span className={`placement-dot ${shape}`} />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <label>Bubble shape</label>
              <div className="shape-grid">
                <button
                  type="button"
                  aria-pressed={shape === "circle"}
                  onClick={() => setShape("circle")}
                >
                  Circle
                </button>
                <button
                  type="button"
                  aria-pressed={shape === "rounded"}
                  onClick={() => setShape("rounded")}
                >
                  Rounded
                </button>
              </div>
            </div>
            <p className="hint" style={{ margin: "8px 0 0" }}>
              Preview assumes a 16:9 screen — exact framing depends on the
              surface you pick when recording starts. You can also change
              position and shape later on the playback page.
            </p>
          </div>
        )}

        <p className="hint" style={{ margin: "6px 0 16px" }}>
          The self-view turns off while recording so a captured tab never shows
          a mirror of itself. Tab audio capture works in Chromium; if system
          audio isn't available on your OS, the recording falls back to mic only.
        </p>

        {error && <p className="error" style={{ marginBottom: 12 }}>{error}</p>}
        {rescue && (
          <div className="row" style={{ marginBottom: 14 }}>
            <button
              className="btn btn-amber"
              onClick={() => {
                const e = rescue.mimeType.includes("mp4") ? "mp4" : "webm";
                const url = URL.createObjectURL(rescue.screenBlob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `recording-${Date.now()}.${e}`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 10_000);
              }}
            >
              Download unsaved recording ({formatBytes(rescue.screenBlob.size)})
            </button>
            {rescue.webcamBlob && (
              <button
                className="btn"
                onClick={() => {
                  const e = rescue.webcamMimeType?.includes("mp4") ? "mp4" : "webm";
                  const url = URL.createObjectURL(rescue.webcamBlob!);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `recording-webcam-${Date.now()}.${e}`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 10_000);
                }}
              >
                Webcam file ({formatBytes(rescue.webcamBlob.size)})
              </button>
            )}
          </div>
        )}
        {notice && <p className="warn" style={{ marginBottom: 12 }}>{notice}</p>}

        <button className="btn btn-rec" style={{ fontSize: 16, padding: "12px 26px" }} onClick={start}>
          ● Record — choose tab, window, or screen
        </button>
      </div>
    </div>
  );
}
