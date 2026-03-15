import { useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { sogniAuth } from '@/services/sogniAuth';
import Button from '@/components/common/Button';

interface Props {
  onSignup: () => void;
  onClose: () => void;
}

function LoginForm({ onSignup, onClose }: Props) {
  const { addToast } = useToast();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password.');
      return;
    }

    setIsLoading(true);

    try {
      const success = await sogniAuth.login(username.trim(), password);

      if (success) {
        addToast('success', `Welcome back, ${username.trim()}!`);
        setUsername('');
        setPassword('');
        onClose();
      } else {
        const authState = sogniAuth.getAuthState();
        setError(authState.error || 'Login failed. Please check your credentials and try again.');
      }
    } catch (err: unknown) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      if ((err as any)?.code === 4052 || (err instanceof Error && err.message?.includes('verify your email'))) {
        setError('Email verification required. Please verify your email at app.sogni.ai and try again.');
        window.dispatchEvent(new CustomEvent('sogni-email-verification-required', {
          detail: {
            error: err,
            message: 'Your Sogni account email needs to be verified to generate images.',
          },
        }));
      } else {
        setError(err instanceof Error ? err.message : 'Login failed. Please check your credentials and try again.');
      }
      /* eslint-enable @typescript-eslint/no-explicit-any */
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Header */}
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-primary-500 shadow-lg shadow-primary-400/20">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <h2 className="font-display text-xl font-bold text-white">Welcome Back</h2>
        <p className="mt-1 text-sm text-white/40">Sign in to your Sogni account</p>
      </div>

      <div>
        <label
          htmlFor="login-username"
          className="mb-1.5 block text-sm font-medium text-white/50"
        >
          Username
        </label>
        <input
          id="login-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Enter your username"
          autoComplete="username"
          className="w-full rounded-xl border border-primary-400/[0.08] bg-surface-800/50 px-4 py-2.5 text-sm text-white placeholder-white/25 outline-none transition-colors focus:border-primary-400/25 focus:bg-surface-800/80"
          disabled={isLoading}
        />
      </div>

      <div>
        <label
          htmlFor="login-password"
          className="mb-1.5 block text-sm font-medium text-white/50"
        >
          Password
        </label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
          autoComplete="current-password"
          className="w-full rounded-xl border border-primary-400/[0.08] bg-surface-800/50 px-4 py-2.5 text-sm text-white placeholder-white/25 outline-none transition-colors focus:border-primary-400/25 focus:bg-surface-800/80"
          disabled={isLoading}
        />
      </div>

      {error && (
        <div className="rounded-lg bg-secondary-500/8 px-3 py-2 text-sm text-secondary-400">
          {error}
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        fullWidth
        loading={isLoading}
      >
        Sign In
      </Button>

      <p className="text-center text-xs text-white/25">
        Don&apos;t have an account?{' '}
        <button
          type="button"
          onClick={onSignup}
          className="text-primary-300 transition-colors hover:text-primary-200"
        >
          Sign up
        </button>
      </p>
    </form>
  );
}

export default LoginForm;
