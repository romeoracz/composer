"use client";
import { useEffect, useState } from "react";

export default function HistoryPage() {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/history", { credentials:"include" }).then(r=>r.json()).then(d=> setItems(d.items || []));
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>History</h1>
      <ul>
        {items.map(h => (
          <li key={h.id} style={{ border:"1px solid #ddd", margin:"8px 0", padding:8 }}>
            <div><strong>{h.platform}</strong> — {new Date(h.publishedAt).toLocaleString()}</div>
            <pre style={{ whiteSpace:"pre-wrap" }}>{h.editedText || h.originalText}</pre>
          </li>
        ))}
      </ul>
    </main>
  );
}
