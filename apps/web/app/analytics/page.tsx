"use client";
import { useEffect, useState } from "react";

export default function AnalyticsPage() {
  const [metrics, setMetrics] = useState<any[]>([]);

  async function load() {
    const r = await fetch("/api/analytics/list", { credentials:"include" });
    const d = await r.json();
    setMetrics(d.metrics || []);
  }

  useEffect(() => { load(); }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Analytics</h1>
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead>
          <tr>
            <th style={{ borderBottom:"1px solid #ddd", textAlign:"left" }}>postId</th>
            <th style={{ borderBottom:"1px solid #ddd", textAlign:"left" }}>platform</th>
            <th style={{ borderBottom:"1px solid #ddd", textAlign:"right" }}>likes</th>
            <th style={{ borderBottom:"1px solid #ddd", textAlign:"right" }}>comments</th>
            <th style={{ borderBottom:"1px solid #ddd", textAlign:"right" }}>shares</th>
            <th style={{ borderBottom:"1px solid #ddd", textAlign:"right" }}>impressions</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m, i) => (
            <tr key={i}>
              <td style={{ borderBottom:"1px solid #eee" }}>{m.postId}</td>
              <td style={{ borderBottom:"1px solid #eee" }}>{m.platform}</td>
              <td style={{ borderBottom:"1px solid #eee", textAlign:"right" }}>{m.likes}</td>
              <td style={{ borderBottom:"1px solid #eee", textAlign:"right" }}>{m.comments}</td>
              <td style={{ borderBottom:"1px solid #eee", textAlign:"right" }}>{m.shares}</td>
              <td style={{ borderBottom:"1px solid #eee", textAlign:"right" }}>{m.impressions ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
