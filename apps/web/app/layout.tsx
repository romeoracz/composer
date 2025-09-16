export const metadata = { title: 'ComposR' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav style={{ padding: 12, borderBottom: '1px solid #eee' }}>
          <a href="/" style={{ marginRight: 12 }}>Home</a>
          <a href="/review" style={{ marginRight: 12 }}>Review</a>
          <a href="/integrations" style={{ marginRight: 12 }}>Integrations</a>
          <a href="/settings" style={{ marginRight: 12 }}>Settings</a>
          <a href="/history" style={{ marginRight: 12 }}>History</a>
          <a href="/analytics">Analytics</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
