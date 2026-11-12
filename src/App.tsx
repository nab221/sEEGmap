import { useEffect } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useStore } from "./store/useStore";
import Home from "./pages/Home";
import Planner from "./pages/Planner";
import AxialView from "./pages/AxialView";
import Settings from "./pages/Settings";
import AnatomyLibraryPage from "./pages/AnatomyLibrary";
import Mark from "./components/Mark";

export default function App() {
  const loadConfigs = useStore((s) => s.loadConfigs);
  const hydrateFromDB = useStore((s) => s.hydrateFromDB);
  const location = useLocation();

  useEffect(() => {
    loadConfigs();
    hydrateFromDB();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isHome = location.pathname === "/";

  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      {!isHome && (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 20px",
            borderBottom: "1px solid var(--line)",
            background: "var(--surface)",
            position: "sticky",
            top: 0,
            zIndex: 20,
          }}
        >
          <NavLink to="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", color: "var(--ink)" }}>
            <Mark size={22} />
            <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>sEEGmap</span>
          </NavLink>
          <nav style={{ display: "flex", gap: 4 }}>
            <NavTab to="/planner">Planner</NavTab>
            <NavTab to="/axial">Electrode view</NavTab>
            <NavTab to="/settings">Settings</NavTab>
            <NavTab to="/settings/anatomy">Anatomy Library</NavTab>
          </nav>
        </header>
      )}
      <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/planner" element={<Planner />} />
          <Route path="/axial" element={<AxialView />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/anatomy" element={<AnatomyLibraryPage />} />
        </Routes>
      </main>
    </div>
  );
}

function NavTab({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        padding: "8px 14px",
        borderRadius: 8,
        fontSize: 13.5,
        fontWeight: 500,
        textDecoration: "none",
        color: isActive ? "var(--accent)" : "var(--muted)",
        background: isActive ? "var(--accent-soft)" : "transparent",
      })}
    >
      {children}
    </NavLink>
  );
}
