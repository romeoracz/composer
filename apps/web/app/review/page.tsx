"use client";
import { useEffect, useState } from "react";

export default function ReviewPage() {
  const [seeds, setSeeds] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [drafts, setDrafts] = useState<any[]>([]);
  const [platforms, setPlatforms] = useState<string[]>(["linkedin","x"]);
  const [msg, setMsg] = useState("");

  async function loadSeeds() {
    const r = await fetch("/api/seeds", { credentials: "include" });
    const d = await r.json();
    setSeeds(d.items || []);
  }

  async function loadDrafts(seedId?: string) {
    const q = seedId ? `?seedId=${seedId}` : "";
    const r = await fetch(`/api/drafts${q}`, { credentials: "include" });
    const d = await r.json();
    setDrafts(d.items || []);
  }

  useEffect(() => { loadSeeds(); loadDrafts(); }, []);

  async function addSeed() {
    setMsg("");
    const csrf = await fetch("/api/csrf-token", { credentials: "include" }).then(r=>r.json());
    const r = await fetch(`/api/seeds`, {
      method: "POST",
      headers: { "Content-Type":"application/json", "CSRF-Token": csrf.csrfToken },
      credentials: "include",
      body: JSON.stringify({ title })
    });
    if (r.ok) { setTitle(""); loadSeeds(); } else { setMsg("Failed"); }
  }

  async function generate(seedId: string) {
    setMsg("");
    const csrf = await fetch("/api/csrf-token", { credentials: "include" }).then(r=>r.json());
    const r = await fetch(`/api/drafts/generate`, {
      method: "POST",
      headers: { "Content-Type":"application/json", "CSRF-Token": csrf.csrfToken },
      credentials: "include",
      body: JSON.stringify({ seedId, platforms })
    });
    if (r.ok) { await loadDrafts(seedId); setMsg("Generated"); } else { setMsg("Failed to generate"); }
  }

  async function approve(draftId: string) {
    setMsg("");
    const csrf = await fetch("/api/csrf-token", { credentials: "include" }).then(r=>r.json());
    const r = await fetch(`/api/approve`, {
      method: "POST",
      headers: { "Content-Type":"application/json", "CSRF-Token": csrf.csrfToken },
      credentials: "include",
      body: JSON.stringify({ draftId, delayMs: 2000 })
    });
    if (r.ok) setMsg("Approved (queued)"); else setMsg("Approve failed");
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Daily Review</h1>
      <section>
        <h2>Add Seed</h2>
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Seed title" style={{ width:"100%" }} />
        <div style={{ marginTop:8 }}>
          <label><input type="checkbox" checked={platforms.includes("linkedin")} onChange={e=> setPlatforms(p=> e.target.checked ? Array.from(new Set([...p,"linkedin"])) : p.filter(x=>x!=="linkedin")) } /> LinkedIn</label>
          <label style={{ marginLeft:12 }}><input type="checkbox" checked={platforms.includes("x")} onChange={e=> setPlatforms(p=> e.target.checked ? Array.from(new Set([...p,"x"])) : p.filter(x=>x!=="x")) } /> X</label>
        </div>
        <button onClick={addSeed} style={{ marginTop:8 }}>Add</button>
      </section>
      <section style={{ marginTop: 16 }}>
        <h2>Seeds</h2>
        <ul>
          {seeds.map(s => (
            <li key={s.id} style={{ border:"1px solid #ddd", margin:"8px 0", padding:8 }}>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <strong>{s.title}</strong>
                <button onClick={()=>generate(s.id)}>Generate Drafts</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section style={{ marginTop: 16 }}>
        <h2>Drafts</h2>
        <ul>
          {drafts.map(d => (
            <li key={d.id} style={{ border:"1px solid #ddd", margin:"8px 0", padding:8 }}>
              <div><strong>{d.platform}</strong></div>
              <pre style={{ whiteSpace:"pre-wrap" }}>{d.editedText || d.originalText}</pre>
              <button onClick={()=>approve(d.id)}>Approve</button>
            </li>
          ))}
        </ul>
      </section>
      {msg && <p>{msg}</p>}
    </main>
  );
}
