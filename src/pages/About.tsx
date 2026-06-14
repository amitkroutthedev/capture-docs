import { Link } from "react-router-dom";
import { ApiKeyGuide } from "../components/ApiKeyGuide";

export function About() {
  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <span className="eyebrow">About</span>
      <h1 style={{ fontSize: 26, margin: "8px 0 16px" }}>CaptureDocs</h1>

      <div className="panel">
        <p style={{ marginTop: 0 }}>
          CaptureDocs records any tab, window, or screen, with mic, system
          audio, and an optional webcam bubble, then turns it into something
          you can read: editable AI subtitles, a searchable click-to-seek
          transcript, and auto-generated chapters with a short summary.
        </p>

        <span className="eyebrow">Fully client-side</span>
        <p style={{ marginTop: 6 }}>
          There is no server and no account. Everything runs in your browser:
        </p>
        <ul className="about-list">
          <li>
            <strong>Recordings</strong> are stored in this browser's IndexedDB,
            on this device only. They are not uploaded anywhere.
          </li>
          <li>
            <strong>API keys</strong> for your transcription and chapter
            providers are stored in this browser's localStorage and sent only
            to the provider you select, directly from your browser.
          </li>
          <li>
            <strong>Settings</strong> (provider choices, webcam preferences)
            live in the same browser storage.
          </li>
        </ul>

        <span className="eyebrow">What this means for your data</span>
        <p className="warn" style={{ marginTop: 6 }}>
          Because nothing leaves this browser, nothing is backed up. Clearing
          browser data, switching devices or browsers, or the browser evicting
          storage under disk pressure will lose your recordings. Download
          anything you want to keep. Treat the API keys here as revocable,
          low-limit keys — localStorage is readable by any script on the page.
        </p>
        <p className="hint">
          A deployed version would move recordings to object storage and keep
          keys server-side; this build is intentionally local-only.
        </p>

        <span className="eyebrow">Best in Chromium</span>
        <p style={{ marginTop: 6, marginBottom: 0 }}>
          CaptureDocs relies on the browser's screen-capture and recording APIs,
          which are most complete in Chromium browsers like Chrome, Edge, Brave,
          Arc. Safari and Firefox support them only partially, so recording
          there is unreliable; the app says so up front rather than failing
          halfway. Playback works everywhere.
        </p>
      </div>

      <p className="hint" style={{ marginTop: 14 }}>
        Manage providers and keys in <Link to="/settings">Settings</Link>.
      </p>
       <ApiKeyGuide />
    </div>
  );
}