'use client';

import { useState, useRef, useEffect } from 'react';
import { useMutation } from 'urql';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth';
import { LOGIN_MUTATION, REGISTER_MUTATION } from '@/lib/graphql/mutations';

type Tab = 'login' | 'register';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [tab, setTab] = useState<Tab>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const usernameRef = useRef<HTMLInputElement>(null);

  const [, loginMut] = useMutation(LOGIN_MUTATION);
  const [, registerMut] = useMutation(REGISTER_MUTATION);

  useEffect(() => {
    usernameRef.current?.focus();
  }, [tab]);

  const reset = () => {
    setUsername('');
    setEmail('');
    setPassword('');
  };

  const handleSubmit = async () => {
    if (!username.trim() || !password.trim()) return;

    if (tab === 'login') {
      const { data, error } = await loginMut({
        input: { username: username.trim(), password },
      });
      if (error || !data?.login) {
        toast.error(error?.message ?? 'Invalid credentials');
        return;
      }
      setAuth(data.login.token, data.login.user);
    } else {
      if (!email.trim()) return;
      const { data, error } = await registerMut({
        input: { username: username.trim(), email: email.trim(), password },
      });
      if (error || !data?.register) {
        toast.error(error?.message ?? 'Registration failed');
        return;
      }
      setAuth(data.register.token, data.register.user);
    }
    router.push('/');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors ${
      tab === t ? 'text-accent' : 'text-muted-foreground hover:text-foreground'
    }`;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div
        data-augmented-ui="tl-clip tr-clip br-clip bl-clip border"
        className="w-[400px] bg-card"
        style={{
          '--aug-tl': '18px',
          '--aug-tr': '18px',
          '--aug-br': '18px',
          '--aug-bl': '18px',
          '--aug-border-all': '2px',
          '--aug-border-bg': 'var(--accent)',
        } as React.CSSProperties}
      >
        <div className="p-6" onKeyDown={handleKeyDown}>
          {/* Logo */}
          <div className="flex items-center gap-3 mb-6">
            <div
              data-augmented-ui="tl-clip br-clip border"
              className="w-10 h-10 flex items-center justify-center"
              style={{
                '--aug-tl': '7px',
                '--aug-br': '7px',
                '--aug-border-all': '2px',
                '--aug-border-bg': 'var(--accent)',
              } as React.CSSProperties}
            >
              <span className="text-accent font-bold text-lg">A</span>
            </div>
            <h1 className="text-lg font-bold text-foreground tracking-tight">
              agentobox
            </h1>
          </div>

          {/* Tabs */}
          <div
            className="flex items-center gap-0 mb-6"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <button
              className={tabClass('login')}
              onClick={() => { setTab('login'); reset(); }}
            >
              <span
                style={
                  tab === 'login'
                    ? { borderBottom: '2px solid var(--accent)', paddingBottom: '6px' }
                    : undefined
                }
              >
                Login
              </span>
            </button>
            <button
              className={tabClass('register')}
              onClick={() => { setTab('register'); reset(); }}
            >
              <span
                style={
                  tab === 'register'
                    ? { borderBottom: '2px solid var(--accent)', paddingBottom: '6px' }
                    : undefined
                }
              >
                Register
              </span>
            </button>
          </div>

          {/* Username */}
          <div className="mb-4">
            <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider block mb-1.5">
              Username
            </label>
            <div
              data-augmented-ui="tl-clip br-clip border"
              style={{
                '--aug-tl': '8px',
                '--aug-br': '8px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
              } as React.CSSProperties}
            >
              <input
                ref={usernameRef}
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="veyorokon"
                className="w-full bg-transparent text-foreground font-mono text-sm px-3 py-2.5 placeholder:text-muted-foreground/40 focus:outline-none"
              />
            </div>
          </div>

          {/* Email (register only) */}
          {tab === 'register' && (
            <div className="mb-4">
              <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider block mb-1.5">
                Email
              </label>
              <div
                data-augmented-ui="tl-clip br-clip border"
                style={{
                  '--aug-tl': '8px',
                  '--aug-br': '8px',
                  '--aug-border-all': '1px',
                  '--aug-border-bg': 'var(--border)',
                } as React.CSSProperties}
              >
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-transparent text-foreground font-mono text-sm px-3 py-2.5 placeholder:text-muted-foreground/40 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Password */}
          <div className="mb-6">
            <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider block mb-1.5">
              Password
            </label>
            <div
              data-augmented-ui="tl-clip br-clip border"
              style={{
                '--aug-tl': '8px',
                '--aug-br': '8px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
              } as React.CSSProperties}
            >
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="********"
                className="w-full bg-transparent text-foreground font-mono text-sm px-3 py-2.5 placeholder:text-muted-foreground/40 focus:outline-none"
              />
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!username.trim() || !password.trim() || (tab === 'register' && !email.trim())}
            data-augmented-ui="tl-clip br-clip border"
            className="w-full px-5 py-2.5 text-accent-foreground font-bold text-xs uppercase tracking-wider bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              '--aug-tl': '8px',
              '--aug-br': '8px',
              '--aug-border-all': '2px',
              '--aug-border-bg': 'var(--accent)',
            } as React.CSSProperties}
          >
            {tab === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </div>
      </div>
    </div>
  );
}
