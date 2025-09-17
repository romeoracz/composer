"use client";
import { useCallback, useEffect, useState, type CSSProperties } from "react";

type ProviderKey = "linkedin" | "x" | "instagram" | "facebook" | "tiktok";

type ProviderStatus = {
  key: ProviderKey;
  hasCreds: boolean;
  creds?: { clientId?: string; clientSecret?: string; accessToken?: string; refreshToken?: string };
  lastUpdatedAt?: number;
  lastVerifiedAt?: number;
  lastStatus?: "ok" | "failed";
  lastError?: string;
};

type FormState = Record<ProviderKey, { clientId: string; clientSecret: string; accessToken: string; refreshToken: string }>;
type MessageState = Record<ProviderKey, string>;
type BusyState = Record<ProviderKey, boolean>;

const PROVIDER_KEYS: ProviderKey[] = ["linkedin", "x", "instagram", "facebook", "tiktok"];

export default function IntegrationsPage() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [forms, setForms] = useState<FormState>(() => initialiseForms());
  const [messages, setMessages] = useState<MessageState>({ linkedin: "", x: "", instagram: "", facebook: "", tiktok: "" });
  const [busy, setBusy] = useState<BusyState>({ linkedin: false, x: false, instagram: false, facebook: false, tiktok: false });
  const [csrfToken, setCsrfToken] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const r = await fetch("/api/integrations/status", { credentials: "include" });
    if (!r.ok) return;
    const d = await r.json();
    const list: ProviderStatus[] = d.providers || [];
    setProviders(list);
    setForms((prev) => {
      const next = { ...prev } as FormState;
      for (const key of PROVIDER_KEYS) {
        if (!next[key]) {
          next[key] = { clientId: "", clientSecret: "", accessToken: "", refreshToken: "" };
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const ensureCsrf = useCallback(async () => {
    if (csrfToken) return csrfToken;
    const r = await fetch("/api/csrf-token", { credentials: "include" });
    if (!r.ok) throw new Error("csrf_fetch_failed");
    const data = await r.json();
    setCsrfToken(data.csrfToken);
    return data.csrfToken as string;
  }, [csrfToken]);

  function handleInputChange(key: ProviderKey, field: keyof FormState[ProviderKey], value: string) {
    setForms((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value,
      },
    }));
  }

  async function saveCredentials(key: ProviderKey) {
    setBusy((prev) => ({ ...prev, [key]: true }));
    setMessages((prev) => ({ ...prev, [key]: "" }));
    try {
      const token = await ensureCsrf();
      const body = forms[key];
      const r = await fetch(`/api/integrations/creds/${key}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CSRF-Token": token,
        },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        throw new Error("save_failed");
      }
      setMessages((prev) => ({ ...prev, [key]: "Credentials saved" }));
      await loadStatus();
    } catch (err) {
      console.error(err);
      setMessages((prev) => ({ ...prev, [key]: "Save failed" }));
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function testIntegration(key: ProviderKey) {
    setBusy((prev) => ({ ...prev, [key]: true }));
    setMessages((prev) => ({ ...prev, [key]: "" }));
    try {
      const token = await ensureCsrf();
      const r = await fetch(`/api/integrations/test/${key}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CSRF-Token": token,
        },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (r.status === 404) {
        setMessages((prev) => ({ ...prev, [key]: "Sandbox tests disabled in this environment" }));
        return;
      }
      if (!r.ok) throw new Error("test_failed");
      const data = await r.json();
      setMessages((prev) => ({ ...prev, [key]: data.ok ? "Connection successful" : data.details || "Connection failed" }));
      await loadStatus();
    } catch (err) {
      console.error(err);
      setMessages((prev) => ({ ...prev, [key]: "Test failed" }));
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <h1>Integrations</h1>
      <p style={{ color: "#555", marginBottom: 24 }}>
        Store provider API credentials securely, view status, and run sandbox connection tests. Existing secret values are shown in redacted form.
      </p>
      <div style={{ display: "grid", gap: 16 }}>
        {PROVIDER_KEYS.map((key) => {
          const provider = providers.find((p) => p.key === key);
          const status = provider?.lastStatus;
          const message = messages[key];
          return (
            <section key={key} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
              <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2 style={{ margin: 0, textTransform: "capitalize" }}>{key}</h2>
                <StatusBadge status={status} />
              </header>
              <StatusSummary provider={provider} />
              <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                <label>
                  <span style={{ display: "block", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>Client ID</span>
                  <input
                    value={forms[key].clientId}
                    onChange={(e) => handleInputChange(key, "clientId", e.target.value)}
                    placeholder="Enter client ID"
                    style={inputStyle}
                  />
                </label>
                <label>
                  <span style={{ display: "block", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>Client Secret</span>
                  <input
                    value={forms[key].clientSecret}
                    onChange={(e) => handleInputChange(key, "clientSecret", e.target.value)}
                    placeholder="Enter client secret"
                    style={inputStyle}
                  />
                </label>
                <label>
                  <span style={{ display: "block", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>Access Token (optional)</span>
                  <input
                    value={forms[key].accessToken}
                    onChange={(e) => handleInputChange(key, "accessToken", e.target.value)}
                    placeholder="Enter access token"
                    style={inputStyle}
                  />
                </label>
                <label>
                  <span style={{ display: "block", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>Refresh Token (optional)</span>
                  <input
                    value={forms[key].refreshToken}
                    onChange={(e) => handleInputChange(key, "refreshToken", e.target.value)}
                    placeholder="Enter refresh token"
                    style={inputStyle}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button onClick={() => saveCredentials(key)} disabled={busy[key]} style={buttonStyle}>
                  {busy[key] ? "Saving…" : "Save"}
                </button>
                <button onClick={() => testIntegration(key)} disabled={busy[key]} style={{ ...buttonStyle, background: "#fff", color: "#333", border: "1px solid #ccc" }}>
                  {busy[key] ? "Testing…" : "Test Connection"}
                </button>
              </div>
              {message && <p style={{ marginTop: 12, color: message.includes("failed") ? "#c00" : "#0a8" }}>{message}</p>}
              {provider?.creds && (
                <p style={{ fontSize: 12, color: "#666", marginTop: 12 }}>
                  Stored secrets: clientId {provider.creds.clientId || "—"}, clientSecret {provider.creds.clientSecret || "—"}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}

function initialiseForms(): FormState {
  return PROVIDER_KEYS.reduce((acc, key) => {
    acc[key] = { clientId: "", clientSecret: "", accessToken: "", refreshToken: "" };
    return acc;
  }, {} as FormState);
}

function StatusBadge({ status }: { status?: "ok" | "failed" }) {
  if (!status) return <span style={{ fontSize: 12, color: "#666" }}>Not verified</span>;
  const color = status === "ok" ? "#0a8" : "#c00";
  const label = status === "ok" ? "Verified" : "Needs attention";
  return <span style={{ fontSize: 12, fontWeight: 600, color }}>{label}</span>;
}

function StatusSummary({ provider }: { provider?: ProviderStatus }) {
  if (!provider) {
    return <p style={{ margin: 0, color: "#666" }}>No credentials stored yet.</p>;
  }
  const { hasCreds, lastUpdatedAt, lastVerifiedAt, lastStatus, lastError } = provider;
  return (
    <div style={{ fontSize: 13, color: "#555" }}>
      <p style={{ margin: 0 }}>{hasCreds ? "Credentials stored." : "No credentials stored."}</p>
      <p style={{ margin: "4px 0" }}>Last updated: {lastUpdatedAt ? formatTimestamp(lastUpdatedAt) : "—"}</p>
      <p style={{ margin: 0 }}>Last verified: {lastVerifiedAt ? formatTimestamp(lastVerifiedAt) : "—"}</p>
      {lastStatus === "failed" && lastError && <p style={{ margin: "4px 0", color: "#c00" }}>Last error: {lastError}</p>}
    </div>
  );
}

function formatTimestamp(ts: number) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ts));
  } catch {
    return "—";
  }
}

const inputStyle: CSSProperties = {
  marginTop: 4,
  width: "100%",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #ccc",
  fontSize: 14,
};

const buttonStyle: CSSProperties = {
  background: "#0a8",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "8px 16px",
  fontSize: 14,
  cursor: "pointer",
};
