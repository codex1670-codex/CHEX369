import { useState, lazy, Suspense } from 'react';
import { useAuth } from '../AuthContext.jsx';

// Three.js is loaded on demand so it never slows the first paint.
const Globe3D = lazy(() => import('../three/Globe3D'));

export default function Auth() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState('login');
  const [needs2FA, setNeeds2FA] = useState(false);
  const [ownerMode, setOwnerMode] = useState(false);   // owner login: both passwords on one screen
  const [needsPw2, setNeedsPw2] = useState(false);   // the master account asks for a second password
  const [form, setForm] = useState({ identifier: '', password: '', username: '', email: '', displayName: '', totpCode: '', password2: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (mode === 'login') {
        const result = await login(form.identifier, form.password, form.totpCode || undefined, form.password2 || undefined);
        if (result.requires2FA) { setNeeds2FA(true); setBusy(false); return; }
        if (result.requiresPassword2) { setNeedsPw2(true); setBusy(false); return; }
        if (result.reactivated) setNotice('Welcome back! Your account has been reactivated.');
      } else {
        await signup({ username: form.username, email: form.email, password: form.password, displayName: form.displayName });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <div className="glass-card auth-card">
        <Suspense fallback={null}><Globe3D size={170} /></Suspense>
        <h1><img src="/logo.png" alt="" width="44" height="44" style={{borderRadius:'50%',verticalAlign:'middle',marginRight:10}} />CHEX</h1>
        <p className="sub">CONNECT. CREATE. CHAT. PLAY. THINK.</p>
        {error && <div className="error-banner">{error}</div>}
        {notice && <div className="request-banner">{notice}</div>}
        <form onSubmit={submit}>
          {needs2FA && (
            <div className="field">
              <label>6-digit authenticator code</label>
              <input value={form.totpCode} onChange={update('totpCode')} placeholder="6-digit code" inputMode="numeric" maxLength={6} autoFocus required />
            </div>
          )}
          {!needs2FA && !needsPw2 && mode === 'signup' && (
            <>
              <div className="field">
                <label>Username</label>
                <input value={form.username} onChange={update('username')} placeholder="Username" autoComplete="username" required />
              </div>
              <div className="field">
                <label>Display name</label>
                <input value={form.displayName} onChange={update('displayName')} placeholder="Display name" />
              </div>
              <div className="field">
                <label>Email</label>
                <input type="email" value={form.email} onChange={update('email')} placeholder="Email" required />
              </div>
            </>
          )}
          {needsPw2 && (
            <div className="field">
              <label>Second password</label>
              <input type="password" value={form.password2} onChange={update('password2')} placeholder="Second password" autoComplete="off" autoFocus required />
            </div>
          )}
          {mode === 'login' && !needs2FA && !needsPw2 && (
            <div className="field">
              <label>Username or email</label>
              <input value={form.identifier} onChange={update('identifier')} placeholder="Username or email" autoComplete="username" required />
            </div>
          )}
          {!needs2FA && !needsPw2 && (
            <div className="field">
              <label>Password</label>
              <input type="password" value={form.password} onChange={update('password')} placeholder="Password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
            </div>
          )}
          {ownerMode && mode === 'login' && !needs2FA && !needsPw2 && (
            <div className="field">
              <label>Second password (owner)</label>
              <input type="password" value={form.password2} onChange={update('password2')} placeholder="Second password" autoComplete="off" autoCapitalize="off" required />
            </div>
          )}
          <button className="btn-primary" disabled={busy} type="submit">
            {busy ? 'Please wait…' : needs2FA || needsPw2 ? 'Verify' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
        <div className="switch-line">
          {needsPw2 ? (
            <button onClick={() => { setNeedsPw2(false); setForm(f => ({ ...f, password: '', password2: '' })); setError(''); }}>← Start over</button>
          ) : mode === 'login' ? (
            <>New to CHEX? <button onClick={() => { setMode('signup'); setError(''); }}>Create an account</button></>
          ) : (
            <>Already have an account? <button onClick={() => { setMode('login'); setError(''); }}>Log in</button></>
          )}
        </div>
        {mode === 'login' && !needsPw2 && !needs2FA && (
          <div className="switch-line">
            <button type="button" onClick={() => { setOwnerMode(m => !m); setForm(f => ({ ...f, password2: '' })); setError(''); }}>
              {ownerMode ? 'Normal login' : 'Owner login (two passwords)'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
