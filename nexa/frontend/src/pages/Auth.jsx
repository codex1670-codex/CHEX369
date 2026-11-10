import { useState, lazy, Suspense } from 'react';
import { useAuth } from '../AuthContext.jsx';

// Three.js is loaded on demand so it never slows the first paint.
const Globe3D = lazy(() => import('../three/Globe3D'));

export default function Auth() {
  const { login, loginVerify, signup } = useAuth();
  const [mode, setMode] = useState('login');
  const [needs2FA, setNeeds2FA] = useState(false);
  const [step2, setStep2] = useState(null);   // { challenge } once a second step is required
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
        if (step2) {
          await loginVerify(step2.challenge, form.password2);
          return;
        }
        const result = await login(form.identifier, form.password, form.totpCode || undefined);
        if (result.requires2FA) { setNeeds2FA(true); setBusy(false); return; }
        if (result.requiresPassword2) { setStep2({ challenge: result.challenge }); setForm(f => ({ ...f, password: '' })); setBusy(false); return; }
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
          {!needs2FA && !step2 && mode === 'signup' && (
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
          {!!step2 && (
            <div className="field">
              <label>Verification</label>
              <input type="password" value={form.password2} onChange={update('password2')} placeholder="Password" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus required />
            </div>
          )}
          {mode === 'login' && !needs2FA && !step2 && (
            <div className="field">
              <label>Username or email</label>
              <input value={form.identifier} onChange={update('identifier')} placeholder="Username or email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
            </div>
          )}
          {!needs2FA && !step2 && (
            <div className="field">
              <label>Password</label>
              <input type="password" value={form.password} onChange={update('password')} placeholder="Password" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
            </div>
          )}
          <button className="btn-primary" disabled={busy} type="submit">
            {busy ? 'Please wait…' : needs2FA || !!step2 ? 'Verify' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
        <div className="switch-line">
          {!!step2 ? (
            <button onClick={() => { setStep2(null); setForm(f => ({ ...f, password: '', password2: '' })); setError(''); }}>← Start over</button>
          ) : mode === 'login' ? (
            <>New to CHEX? <button onClick={() => { setMode('signup'); setError(''); }}>Create an account</button></>
          ) : (
            <>Already have an account? <button onClick={() => { setMode('login'); setError(''); }}>Log in</button></>
          )}
        </div>
      </div>
    </div>
  );
}
