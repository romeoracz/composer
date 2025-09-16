"use client";
import { useEffect, useState } from 'react';

export default function LoginPage() {
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('changeme');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/csrf-token', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setCsrfToken(d.csrfToken || ''))
      .catch(() => setError('Failed to initialize.'));
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });
    if (res.ok) {
      window.location.href = '/';
    } else {
      setError('Invalid credentials');
    }
  };

  return (
    <main style={{ padding: 24, maxWidth: 400, margin: '0 auto', fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1>Login</h1>
      <form onSubmit={onSubmit}>
        <div style={{ marginTop: 12 }}>
          <label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ display: 'block', width: '100%' }} />
        </div>
        <div style={{ marginTop: 12 }}>
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ display: 'block', width: '100%' }} />
        </div>
        <button type="submit" style={{ marginTop: 16 }}>Sign in</button>
        {error && <p style={{ color: 'red' }}>{error}</p>}
      </form>
    </main>
  );
}
