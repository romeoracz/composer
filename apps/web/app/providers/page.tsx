async function getProviders() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_ORIGIN || ''}/api/providers`, { cache: 'no-store' });
  if (!res.ok) return [] as any[];
  const data = await res.json();
  return data.providers || [];
}

export default async function ProvidersPage() {
  const providers = await getProviders();
  return (
    <main style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1>Providers</h1>
      <p>Feature flags control availability. Constraints shown below.</p>
      <ul>
        {providers.map((p: any) => (
          <li key={p.key} style={{ margin: '12px 0', padding: 12, border: '1px solid #ddd' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{p.displayName}</strong>
              <span>{p.enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
            <div>Max text length: {p.constraints.maxTextLength ?? 'n/a'}</div>
            <div>Media: {(p.constraints.supportsMedia || []).join(', ')}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}
