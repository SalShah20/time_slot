'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [showForgot, setShowForgot] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      router.push('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
        scopes: 'https://www.googleapis.com/auth/calendar',
        // access_type: 'offline' gets a refresh token on first sign-in.
        // No 'prompt: consent' — Google only shows the full consent screen once,
        // then skips straight to account picker on repeat sign-ins.
        queryParams: { access_type: 'offline' },
      },
    });
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      });
      if (authError) throw authError;
      setForgotSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  const Logo = () => (
    <div className="flex items-center gap-2 justify-center">
      <div className="w-9 h-9 bg-teal-600 rounded-xl flex items-center justify-center">
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <span className="text-2xl font-bold text-surface-900">TimeSlot</span>
    </div>
  );

  const GoogleButton = ({ label }: { label: string }) => (
    <button
      onClick={handleGoogleLogin}
      className="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-surface-200 rounded-lg text-sm font-medium text-surface-700 hover:bg-surface-50 transition-colors"
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-surface-200 p-8 flex flex-col gap-5 w-full max-w-sm">
        <Logo />
        <p className="text-surface-500 text-sm text-center -mt-1">
          Stop forgetting. Start doing.
        </p>

        {showForgot ? (
          <>
            <h2 className="text-sm font-semibold text-surface-700 text-center">Reset your password</h2>
            {forgotSent ? (
              <p className="text-sm text-teal-700 bg-teal-50 px-3 py-2.5 rounded-lg text-center">
                Check your email for a reset link.
              </p>
            ) : (
              <form onSubmit={handleForgotPassword} className="flex flex-col gap-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  required
                  className="w-full border border-surface-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 text-surface-900 placeholder:text-surface-400"
                />
                {error && <p className="text-xs text-red-500">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            )}
            <button
              onClick={() => { setShowForgot(false); setError(''); setForgotSent(false); }}
              className="text-sm text-teal-600 hover:underline text-center"
            >
              Back to login
            </button>
          </>
        ) : (
          <>
            {/* Email / password form */}
            <form onSubmit={handleEmailLogin} className="flex flex-col gap-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                required
                autoComplete="email"
                className="w-full border border-surface-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 text-surface-900 placeholder:text-surface-400"
              />
              <div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  required
                  autoComplete="current-password"
                  className="w-full border border-surface-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 text-surface-900 placeholder:text-surface-400"
                />
                <button
                  type="button"
                  onClick={() => { setShowForgot(true); setError(''); }}
                  className="text-xs text-teal-600 hover:underline mt-1.5 block text-right w-full"
                >
                  Forgot password?
                </button>
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Logging in…' : 'Log In'}
              </button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-surface-200" />
              <span className="text-xs text-surface-400">or</span>
              <div className="flex-1 h-px bg-surface-200" />
            </div>

            <GoogleButton label="Continue with Google" />

            <p className="text-center text-sm text-surface-500">
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="text-teal-600 font-medium hover:underline">
                Sign up
              </Link>
            </p>
          </>
        )}

        <div className="flex items-center justify-center gap-3 text-xs text-surface-400">
          <Link href="/privacy" className="hover:text-surface-600 transition-colors">
            Privacy Policy
          </Link>
          <span>&middot;</span>
          <Link href="/terms" className="hover:text-surface-600 transition-colors">
            Terms of Service
          </Link>
        </div>
      </div>
    </div>
  );
}
