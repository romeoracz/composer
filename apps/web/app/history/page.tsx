"use client";
import { useEffect, useState } from "react";

type HistoryItem = {
  id: string;
  platform: string;
  postId: string;
  url?: string | null;
  originalText: string;
  editedText?: string | null;
  publishedAt: number;
  status: "success" | "failed" | "cancelled";
  error?: string | null;
};

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);

  useEffect(() => {
    fetch("/api/history", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setItems((d.items || []) as HistoryItem[]))
      .catch((err) => {
        console.error(err);
      });
  }, []);

  return (
    <main style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <h1>Publish History</h1>
      {items.length === 0 ? (
        <p style={{ color: "#666" }}>No publish attempts yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {items.map((item) => (
            <article key={item.id} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
              <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 16 }}>{item.platform}</h2>
                  <p style={{ margin: "4px 0", color: "#777", fontSize: 12 }}>{new Date(item.publishedAt).toLocaleString()}</p>
                </div>
                <StatusBadge status={item.status} />
              </header>
              {item.url && (
                <p style={{ margin: "4px 0", fontSize: 12 }}>
                  <a href={item.url} target="_blank" rel="noreferrer">
                    View Post
                  </a>
                </p>
              )}
              {item.error && <p style={{ color: "#c00", fontSize: 12 }}>Error: {item.error}</p>}
              <section style={{ marginTop: 12 }}>
                <h3 style={{ margin: "0 0 6px", fontSize: 13 }}>Final Text</h3>
                <pre style={{ whiteSpace: "pre-wrap", background: "#f7f7f7", padding: 12, borderRadius: 8 }}>
                  {item.editedText || item.originalText}
                </pre>
              </section>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: HistoryItem["status"] }) {
  const colors: Record<HistoryItem["status"], { bg: string; color: string; label: string }> = {
    success: { bg: "rgba(10,136,96,0.1)", color: "#0a8", label: "Success" },
    failed: { bg: "#fdeaea", color: "#c00", label: "Failed" },
    cancelled: { bg: "#f1f1f1", color: "#777", label: "Cancelled" },
  };
  const style = colors[status];
  return (
    <span style={{ background: style.bg, color: style.color, padding: "4px 10px", borderRadius: 999, fontSize: 12 }}>
      {style.label}
    </span>
  );
}
