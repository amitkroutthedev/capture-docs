import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { deleteRecording, listRecordings } from "../db";
import { formatTimecode } from "../recorder";
import {
  formatBytes,
  getStorageInfo,
  requestPersistence,
  type StorageInfo,
} from "../storage";
import type { RecordingRecord } from "../types";

export function StorageMeter({ refreshKey }: { refreshKey: number }) {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [persistDenied, setPersistDenied] = useState(false);

  useEffect(() => {
    getStorageInfo().then(setInfo);
  }, [refreshKey]);

  if (!info || info.quotaBytes === 0) return null;
  const pct = Math.min(100, (info.usageBytes / info.quotaBytes) * 100);
  const nearFull = pct >= 80;

  return (
    <div className="meter-wrap">
      <div className="meter-row">
        <span className="eyebrow">Browser storage</span>
        <span>
          <span className="mono">{formatBytes(info.usageBytes)}</span> of{" "}
          <span className="mono">{formatBytes(info.quotaBytes)}</span> this
          browser allows ({pct < 1 ? "<1" : Math.round(pct)}%)
        </span>
        <span style={{ flex: 1 }} />
        {info.persisted ? (
          <span title="The browser has agreed not to evict this data automatically.">
            ● Protected from eviction
          </span>
        ) : (
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              const ok = await requestPersistence();
              if (ok) setInfo({ ...info, persisted: true });
              else setPersistDenied(true);
            }}
          >
            Protect from eviction
          </button>
        )}
      </div>
      <div
        className="meter"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Storage used"
      >
        <span className={nearFull ? "crit" : ""} style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>
      {nearFull && (
        <span className="warn">
          Storage is nearly full. Download recordings you want to keep, then
          delete them here — new recordings will fail to save once the quota is
          hit.
        </span>
      )}
      {!info.persisted && !persistDenied && !nearFull && (
        <span className="hint">
          Recordings live only in this browser and the browser may evict them
          under disk pressure. Download anything you can't lose.
        </span>
      )}
      {persistDenied && (
        <span className="hint">
          The browser declined persistence (its call, based on site
          engagement). Recordings remain evictable — download anything
          important.
        </span>
      )}
    </div>
  );
}

export function Library() {
  const navigate = useNavigate();
  const [recs, setRecs] = useState<RecordingRecord[] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => {
    listRecordings().then(setRecs);
    setRefreshKey((k) => k + 1);
  };
  useEffect(() => {
    refresh();
  }, []);

  if (recs === null) {
    return (
      <div className="status-line">
        <span className="spinner" /> Loading recordings…
      </div>
    );
  }

  if (recs.length === 0) {
    return (
      <div>
        <StorageMeter refreshKey={refreshKey} />
        <div className="empty">
        <div className="timecode mono">00:00</div>
        <h2 style={{ margin: "12px 0 6px" }}>No recordings yet</h2>
        <p className="hint" style={{ marginBottom: 20 }}>
          Record a tab, window, or screen. Subtitles and chapters are generated
          after you stop.
        </p>
        <Link className="btn btn-rec" to="/record">
          ● Start a recording
        </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <StorageMeter refreshKey={refreshKey} />
      <div className="row" style={{ marginBottom: 18 }}>
        <span className="eyebrow">Library</span>
        <span className="hint" style={{ marginLeft: "auto" }}>
          Stored locally in this browser (IndexedDB)
        </span>
      </div>
      <div className="card-grid">
        {recs.map((r) => (
          <div
            key={r.id}
            className="rec-card"
            role="link"
            tabIndex={0}
            onClick={() => navigate(`/r/${r.id}`)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                navigate(`/r/${r.id}`);
              }
            }}
          >
            <span className="title">{r.title}</span>
            <span className="meta mono">
              {formatTimecode(r.durationMs)} · {r.resolution} ·{" "}
              {new Date(r.createdAt).toLocaleString()}
            </span>
            <span className="meta">
              {r.segments
                ? `${r.chapters?.length ?? 0} chapters · subtitled`
                : "no subtitles yet"}
              {r.webcamBlob ? " · webcam" : ""}
            </span>
            <span className="row" style={{ marginTop: 8 }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete “${r.title}”? This cannot be undone.`)) {
                    deleteRecording(r.id).then(refresh);
                  }
                }}
              >
                Delete
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
