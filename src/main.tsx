import { createRoot } from "react-dom/client";
import {
  HashRouter,
  Routes,
  Route,
  Link,
  NavLink,
  useParams,
} from "react-router-dom";
import "./styles.css";
import { Library } from "./pages/Library";
import { Record } from "./pages/Record";
import { Playback } from "./pages/Playback";
import { Settings } from "./pages/Settings";
import { About } from "./pages/About";

function PlaybackRoute() {
  const { id } = useParams();
  return <Playback id={id!} />;
}

function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <Link className="wordmark" to="/">
          <img src="/favicon.svg" alt="" width={22} height={22} /> CaptureDocs
        </Link>
        <nav>
          <NavLink
            to="/about"
            className={({ isActive }) =>
              `btn btn-ghost btn-sm${isActive ? " nav-active" : ""}`
            }
          >
            About
          </NavLink>
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `btn btn-ghost btn-sm${isActive ? " nav-active" : ""}`
            }
          >
            Library
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `btn btn-ghost btn-sm${isActive ? " nav-active" : ""}`
            }
          >
            Settings
          </NavLink>  
          <Link className="btn btn-rec btn-sm" to="/record">
            ● Record
          </Link>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/record" element={<Record />} />
        <Route path="/r/:id" element={<PlaybackRoute />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<Library />} />
      </Routes>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <App />
  </HashRouter>,
);
