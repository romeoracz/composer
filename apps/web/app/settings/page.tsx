"use client";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [versions, setVersions] = useState<any[]>([]);
  const [active, setActive] = useState<any | null>(null);
  const [content, setContent] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    const r = await fetch("/api/prompts", { credentials: "include" });
    const d = await r.json();
    setVersions(d.versions || []);
    setActive(d.active || null);
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setErr("");
    const csrf = await fetch("/api/csrf-token", { credentials: "include" }).then(r => r.json());
    const r = await fetch("/api/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CSRF-Token": csrf.csrfToken },
      credentials: "include",
      body: JSON.stringify({ content, notes })
    });
    if (!r.ok) { setErr("Save failed"); return; }
    setContent(""); setNotes("");
    await load();
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Settings: Master Prompt</h1>
      <section>
        <h2>Create New Version</h2>
        <textarea value={content} onChange={e=>setContent(e.target.value)} rows={6} style={{ width: "100%" }} placeholder="Enter master prompt..." />
        <input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="notes" style={{ display:"block", width:"100%", marginTop:8 }} />
        <button onClick={save} style={{ marginTop: 8 }}>Save</button>
        {err && <p style={{ color:"red" }}>{err}</p>}
      </section>
      <section style={{ marginTop: 16 }}>
        <h2>Versions</h2>
        <ul>
          {versions.map(v => (
            <li key={v.id} style={{ border:"1px solid #ddd", margin:"8px 0", padding:8 }}>
              <div><strong>{new Date(v.createdAt).toLocaleString()}</strong> by {v.author}</div>
              <pre style={{ whiteSpace:"pre-wrap" }}>{v.content}</pre>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
