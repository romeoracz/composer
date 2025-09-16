"use client";
import { useEffect, useState } from "react";

export default function IntegrationsPage() {
  const [providers, setProviders] = useState<any[]>([]);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [key, setKey] = useState("linkedin");
  const [msg, setMsg] = useState("");

  async function load() {
    const r = await fetch("/api/integrations/status", { credentials: "include" });
    const d = await r.json();
    setProviders(d.providers || []);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    setMsg("");
    const csrf = await fetch("/api/csrf-token", { credentials: "include" }).then(r=>r.json());
    const r = await fetch(`/api/integrations/creds/${key}`, {
      method: "POST",
      headers: { "Content-Type":"application/json", "CSRF-Token": csrf.csrfToken },
      credentials: "include",
      body: JSON.stringify({ clientId, clientSecret })
    });
    if (r.ok) { setMsg("Saved"); load(); } else { setMsg("Failed"); }
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Integrations</h1>
      <section>
        <h2>Status</h2>
        <ul>
          {providers.map(p => (
            <li key={p.key}>{p.key}: {p.hasCreds ? "Configured" : "Not configured"}</li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Save Credentials</h2>
        <select value={key} onChange={e=>setKey(e.target.value)}>
          <option value="linkedin">LinkedIn</option>
          <option value="x">X</option>
          <option value="instagram">Instagram</option>
          <option value="facebook">Facebook</option>
          <option value="tiktok">TikTok</option>
        </select>
        <input placeholder="clientId" value={clientId} onChange={e=>setClientId(e.target.value)} style={{ display:"block", width:"100%", marginTop:8 }} />
        <input placeholder="clientSecret" value={clientSecret} onChange={e=>setClientSecret(e.target.value)} style={{ display:"block", width:"100%", marginTop:8 }} />
        <button onClick={save} style={{ marginTop: 8 }}>Save</button>
        {msg && <p>{msg}</p>}
      </section>
    </main>
  );
}
