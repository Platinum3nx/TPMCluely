import { useEffect, useState } from "react";
import { bootstrapApp, saveSecret, saveSetting } from "./lib/tauri";
import type { BootstrapPayload, SecretKey } from "./lib/types";
import { DashboardApp } from "./dashboard/DashboardApp";
import { OnboardingApp } from "./onboarding/OnboardingApp";
import { Settings } from "./dashboard/Settings";
import { SessionWidget } from "./session/SessionWidget";

type ViewKey = "overview" | "onboarding" | "session" | "dashboard" | "settings";

const viewMeta: Array<{ key: ViewKey; label: string; caption: string }> = [
  { key: "overview", label: "Mission", caption: "Foundation snapshot" },
  { key: "onboarding", label: "Onboarding", caption: "Permissions + providers" },
  { key: "session", label: "Session", caption: "Live widget shell" },
  { key: "dashboard", label: "Dashboard", caption: "Review + exports" },
  { key: "settings", label: "Settings", caption: "Local-first controls" },
];

const initialSecrets: Record<SecretKey, string> = {
  gemini_api_key: "",
  deepgram_api_key: "",
  linear_api_key: "",
  linear_team_id: "",
};

export default function App() {
  const [view, setView] = useState<ViewKey>("overview");
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [secretDrafts, setSecretDrafts] = useState(initialSecrets);
  const [savingSecretKey, setSavingSecretKey] = useState<SecretKey | null>(null);

  useEffect(() => {
    void hydrate();
  }, []);

  async function hydrate() {
    try {
      setLoading(true);
      setError(null);
      const payload = await bootstrapApp();
      setBootstrap(payload);
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Failed to bootstrap application shell.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSecret(key: SecretKey) {
    try {
      setSavingSecretKey(key);
      await saveSecret({ key, value: secretDrafts[key] });
      await hydrate();
      setSecretDrafts((current) => ({ ...current, [key]: "" }));
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Failed to save secret.";
      setError(message);
    } finally {
      setSavingSecretKey(null);
    }
  }

  async function handleUpdateSetting(key: string, value: string) {
    try {
      await saveSetting({ key, value });
      await hydrate();
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Failed to update setting.";
      setError(message);
    }
  }

  if (loading) {
    return (
      <main className="app-shell">
        <div className="loading-state">
          <span className="eyebrow">Cluely Desktop</span>
          <h1>Bootstrapping the foundation layer.</h1>
          <p>Loading permissions, settings, diagnostics, and provider state.</p>
        </div>
      </main>
    );
  }

  if (!bootstrap) {
    return (
      <main className="app-shell">
        <div className="error-state">
          <h1>Application shell unavailable</h1>
          <p>{error ?? "Unknown bootstrap failure."}</p>
          <button type="button" onClick={() => void hydrate()}>
            Retry bootstrap
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="hero-strip">
        <div>
          <p className="eyebrow">Cluely Desktop Foundation</p>
          <h1>Session-first meeting intelligence, grounded in local state and explicit system contracts.</h1>
        </div>
        <div className="hero-meta">
          <span>Version {bootstrap.appVersion}</span>
          <span>{bootstrap.diagnostics.mode === "desktop" ? "Desktop runtime" : "Browser-safe mock runtime"}</span>
        </div>
      </section>

      <section className="workspace-shell">
        <aside className="side-nav">
          <div className="side-nav-header">
            <p className="eyebrow">Control Surface</p>
            <h2>{bootstrap.appName}</h2>
          </div>
          <nav>
            {viewMeta.map((item) => (
              <button
                type="button"
                key={item.key}
                className={`nav-pill ${view === item.key ? "nav-pill-active" : ""}`}
                onClick={() => setView(item.key)}
              >
                <strong>{item.label}</strong>
                <span>{item.caption}</span>
              </button>
            ))}
          </nav>
          <article className="side-status">
            <p className="card-title">Foundation Check</p>
            <div className="readiness-row">
              <span>Database</span>
              <strong>{bootstrap.diagnostics.databaseReady ? "Ready" : "Pending"}</strong>
            </div>
            <div className="readiness-row">
              <span>Keychain</span>
              <strong>{bootstrap.diagnostics.keychainAvailable ? "Ready" : "Mock / Pending"}</strong>
            </div>
            <div className="readiness-row">
              <span>State Machine</span>
              <strong>{bootstrap.diagnostics.stateMachineReady ? "Ready" : "Pending"}</strong>
            </div>
          </article>
        </aside>

        <section className="content-stage">
          {error ? (
            <div className="inline-alert">
              <strong>Last error</strong>
              <p>{error}</p>
            </div>
          ) : null}

          {view === "overview" ? (
            <section className="panel">
              <div className="overview-grid">
                <article className="card feature-card">
                  <p className="card-title">Execution Focus</p>
                  <h2>C0 Foundation in progress</h2>
                  <p className="card-detail">
                    The live widget, transcript store, and ticket engine all depend on this layer being stable before
                    feature velocity ramps up.
                  </p>
                </article>
                <article className="card feature-card accent-card">
                  <p className="card-title">Next Critical Path</p>
                  <h2>Widget to Transcript to Context to Dashboard</h2>
                  <p className="card-detail">
                    The first full slice is designed to prove real session persistence before screenshots, briefs, and
                    ticket generation expand the surface area.
                  </p>
                </article>
              </div>
            </section>
          ) : null}

          {view === "onboarding" ? (
            <OnboardingApp
              bootstrap={bootstrap}
              secretDrafts={secretDrafts}
              onSecretDraftChange={(key, value) => {
                setSecretDrafts((current) => ({ ...current, [key]: value }));
              }}
              onSaveSecret={handleSaveSecret}
              savingSecretKey={savingSecretKey}
            />
          ) : null}

          {view === "session" ? <SessionWidget /> : null}

          {view === "dashboard" ? <DashboardApp /> : null}

          {view === "settings" ? <Settings bootstrap={bootstrap} onUpdateSetting={handleUpdateSetting} /> : null}
        </section>
      </section>
    </main>
  );
}
