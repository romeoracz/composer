"use client";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, Fragment } from "react";

type DiffSegment = {
  type: "context" | "added" | "removed";
  value: string;
};

type PromptVersion = {
  id: string;
  orgId: string;
  author: string;
  notes?: string;
  content: string;
  createdAt: number;
  sourceVersionId?: string;
  isActive: boolean;
  diff?: DiffSegment[];
};

type PromptResponse = {
  active: PromptVersion | null;
  versions: PromptVersion[];
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #ccc",
  fontSize: 14,
};

const buttonPrimary: CSSProperties = {
  background: "#0a8",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "10px 18px",
  fontSize: 14,
  cursor: "pointer",
};

const buttonSecondary: CSSProperties = {
  ...buttonPrimary,
  background: "#fff",
  color: "#333",
  border: "1px solid #ccc",
};

export default function SettingsPage() {
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [active, setActive] = useState<PromptVersion | null>(null);
  const [content, setContent] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activateBusyId, setActivateBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);

  const activeSummary = useMemo(() => {
    if (!active) return "No active prompt yet.";
    return `Active version saved ${formatTimestamp(active.createdAt)} by ${active.author}`;
  }, [active]);

  const applyResponse = useCallback((payload: PromptResponse) => {
    setVersions(payload.versions || []);
    setActive(payload.active);
    if (payload.active) {
      setExpandedId((prev) => (prev ? prev : payload.active?.id ?? null));
    }
  }, []);

  const load = useCallback(async () => {
    const r = await fetch("/api/prompts", { credentials: "include" });
    if (!r.ok) {
      console.error("Failed to load prompts");
      return;
    }
    applyResponse(await r.json());
  }, [applyResponse]);

  useEffect(() => {
    load();
  }, [load]);

  const ensureCsrf = useCallback(async () => {
    if (csrfToken) return csrfToken;
    const r = await fetch("/api/csrf-token", { credentials: "include" });
    if (!r.ok) throw new Error("csrf_fetch_failed");
    const data = await r.json();
    setCsrfToken(data.csrfToken);
    return data.csrfToken as string;
  }, [csrfToken]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const trimmed = content.trim();
      if (!trimmed.length) {
        setError("Prompt content is required");
        return;
      }
      const token = await ensureCsrf();
      const r = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CSRF-Token": token },
        credentials: "include",
        body: JSON.stringify({ content: trimmed, notes: notes.trim() || undefined }),
      });
      if (!r.ok) throw new Error("save_failed");
      applyResponse(await r.json());
      setContent("");
      setNotes("");
    } catch (err) {
      console.error(err);
      setError("Unable to save prompt version");
    } finally {
      setBusy(false);
    }
  }

  async function activateVersion(versionId: string) {
    setActivateBusyId(versionId);
    setError(null);
    try {
      const token = await ensureCsrf();
      const source = versions.find((v) => v.id === versionId);
      const activationNotes = source?.notes ? `Reinstated from ${versionId} — ${source.notes}` : `Reinstated from ${versionId}`;
      const r = await fetch("/api/prompts/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CSRF-Token": token },
        credentials: "include",
        body: JSON.stringify({ id: versionId, notes: activationNotes }),
      });
      if (!r.ok) throw new Error("activate_failed");
      applyResponse(await r.json());
    } catch (err) {
      console.error(err);
      setError("Unable to activate version");
    } finally {
      setActivateBusyId(null);
    }
  }

  function toggleExpanded(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <main style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ marginBottom: 8 }}>Master Prompt Settings</h1>
        <p style={{ color: "#555", margin: 0 }}>{activeSummary}</p>
      </header>

      <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginBottom: 24 }}>
        <h2 style={{ marginTop: 0 }}>Create New Version</h2>
        <p style={{ fontSize: 13, color: "#666" }}>Changes are versioned automatically; the newest version becomes active immediately.</p>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          placeholder="Enter the master formatting prompt..."
          style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace" }}
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes (what changed and why)"
          style={{ ...inputStyle, marginTop: 8 }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button style={buttonPrimary} onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save Version"}
          </button>
          <button
            style={buttonSecondary}
            onClick={() => {
              if (active) {
                setContent(active.content);
                setNotes(active.notes ?? "");
              }
            }}
            disabled={!active}
          >
            Use Active Content
          </button>
        </div>
        {error && <p style={{ marginTop: 12, color: "#c00" }}>{error}</p>}
      </section>

      <section>
        <h2 style={{ marginBottom: 12 }}>Version History</h2>
        {versions.length === 0 && <p style={{ color: "#666" }}>No prompt versions yet.</p>}
        <div style={{ display: "grid", gap: 16 }}>
          {versions.map((version) => (
            <article key={version.id} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
              <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong>{formatTimestamp(version.createdAt)}</strong>
                    {version.isActive ? (
                      <span style={{ color: "#0a8", fontWeight: 600 }}>Active</span>
                    ) : (
                      <span style={{ color: "#666", fontSize: 12 }}>Historical</span>
                    )}
                  </div>
                  <p style={{ margin: "4px 0", color: "#555" }}>By {version.author}</p>
                  {version.notes && <p style={{ margin: 0, color: "#444" }}>{version.notes}</p>}
                  {version.sourceVersionId && (
                    <p style={{ margin: "4px 0 0", color: "#777", fontSize: 12 }}>Reinstated from {version.sourceVersionId}</p>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {!version.isActive && (
                    <button
                      style={buttonPrimary}
                      onClick={() => activateVersion(version.id)}
                      disabled={activateBusyId === version.id}
                    >
                      {activateBusyId === version.id ? "Activating…" : "Set Active"}
                    </button>
                  )}
                  <button style={buttonSecondary} onClick={() => toggleExpanded(version.id)}>
                    {expandedId === version.id ? "Hide" : "View"}
                  </button>
                </div>
              </header>

              {expandedId === version.id && (
                <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
                  <section>
                    <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Prompt Content</h3>
                    <pre style={{ background: "#f7f7f7", padding: 12, borderRadius: 8, whiteSpace: "pre-wrap" }}>{version.content}</pre>
                  </section>
                  <section>
                    <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Diff vs Active</h3>
                    {renderDiff(version, active)}
                  </section>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function renderDiff(version: PromptVersion, active: PromptVersion | null) {
  if (!version.diff || version.isActive || !active) {
    return <p style={{ color: "#666" }}>No differences to display.</p>;
  }
  const lines: string[] = [];
  version.diff.forEach((segment) => {
    const prefix = segment.type === "added" ? "+" : segment.type === "removed" ? "-" : " ";
    segment.value.split("\n").forEach((line) => {
      lines.push(`${prefix} ${line}`);
    });
  });
  return (
    <pre style={{ background: "#1e1e1e", color: "#f3f3f3", padding: 12, borderRadius: 8, overflowX: "auto" }}>
      {lines.map((line, idx) => {
        const style: CSSProperties = {};
        if (line.startsWith("+")) style.color = "#81c995";
        else if (line.startsWith("-")) style.color = "#f28b82";
        else style.color = "#f3f3f3";
        return (
          <Fragment key={idx}>
            <span style={style}>{line}</span>
            {"\n"}
          </Fragment>
        );
      })}
    </pre>
  );
}

function formatTimestamp(ts: number) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ts));
  } catch {
    return "Unknown";
  }
}
