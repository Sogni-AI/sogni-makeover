import { useCallback } from 'react';
import { Step1Fields } from '../types';
import useForm from '@/hooks/useForm';
import { useSogniAuth } from '@/services/sogniAuth';
import Button from '@/components/common/Button';

function isEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

interface Props {
  defaults: Step1Fields;
  onLogin: () => void;
  onContinue: (fields: Step1Fields) => void;
}

function Step1({ defaults, onContinue, onLogin }: Props) {
  const { ensureClient } = useSogniAuth();

  const proceed = useCallback(
    (fields: Step1Fields) => {
      onContinue(fields);
      return Promise.resolve();
    },
    [onContinue]
  );

  const validate = useCallback(
    async (fields: Step1Fields) => {
      const errors: Record<string, string> = {};

      if (!fields.username) {
        errors.username = 'Username is required';
      } else {
        try {
          const client = await ensureClient();
          const result = await client.account.validateUsername(fields.username);
          if (result.status === 'error') {
            errors.username = result.message;
          }
        } catch (err: unknown) {
          console.error('Failed to validate username:', err);
        }
      }

      if (!fields.email) {
        errors.email = 'Email is required';
      } else if (!isEmail(fields.email)) {
        errors.email = 'Provide a valid email address';
      }

      return errors;
    },
    [ensureClient]
  );

  const { fields, fieldErrors, error, handleFieldChange, handleFormSubmit, isLoading } = useForm(
    defaults,
    proceed,
    validate
  );

  return (
    <form onSubmit={handleFormSubmit} noValidate>
      <fieldset disabled={isLoading} className="border-none p-0 m-0">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-primary-500 shadow-lg shadow-primary-400/20">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
          </div>
          <h2 className="font-display text-xl font-bold text-white">Create Account</h2>
          <p className="mt-1 text-sm text-white/40">Sign up for free daily credits</p>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-primary-400 to-primary-500 px-3 py-1 text-xs font-semibold text-surface-950 shadow-md shadow-primary-400/20">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
            </svg>
            <span>50 Free Credits Daily</span>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-secondary-500/20 bg-secondary-500/8 px-3 py-2 text-sm text-secondary-400">
            {error.message}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label htmlFor="signup-username" className="mb-1.5 block text-sm font-medium text-white/50">
              Username
            </label>
            <input
              id="signup-username"
              type="text"
              value={fields.username}
              onChange={(e) => handleFieldChange(e.target.value, 'username')}
              placeholder="Choose a username"
              autoComplete="username"
              className={`w-full rounded-xl border bg-surface-800/50 px-4 py-2.5 text-sm text-white placeholder-white/25 outline-none transition-colors focus:bg-surface-800/80 ${
                fieldErrors.username ? 'border-secondary-500/40 focus:border-secondary-500/60' : 'border-primary-400/[0.08] focus:border-primary-400/25'
              }`}
            />
            {fieldErrors.username && <p className="mt-1 text-xs text-secondary-400">{fieldErrors.username}</p>}
          </div>

          <div>
            <label htmlFor="signup-email" className="mb-1.5 block text-sm font-medium text-white/50">
              Email
            </label>
            <input
              id="signup-email"
              type="email"
              value={fields.email}
              onChange={(e) => handleFieldChange(e.target.value, 'email')}
              placeholder="your@email.com"
              autoComplete="email"
              className={`w-full rounded-xl border bg-surface-800/50 px-4 py-2.5 text-sm text-white placeholder-white/25 outline-none transition-colors focus:bg-surface-800/80 ${
                fieldErrors.email ? 'border-secondary-500/40 focus:border-secondary-500/60' : 'border-primary-400/[0.08] focus:border-primary-400/25'
              }`}
            />
            {fieldErrors.email && <p className="mt-1 text-xs text-secondary-400">{fieldErrors.email}</p>}
          </div>

          <div>
            <label htmlFor="signup-referral" className="mb-1.5 block text-sm font-medium text-white/50">
              Referral Code
            </label>
            <input
              id="signup-referral"
              type="text"
              value={fields.referralCode}
              onChange={(e) => handleFieldChange(e.target.value, 'referralCode')}
              placeholder="Optional"
              className="w-full rounded-xl border border-primary-400/[0.08] bg-surface-800/50 px-4 py-2.5 text-sm text-white placeholder-white/25 outline-none transition-colors focus:border-primary-400/25 focus:bg-surface-800/80"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-white/50">
            <input
              type="checkbox"
              checked={fields.subscribe}
              onChange={(e) => handleFieldChange(e.target.checked, 'subscribe')}
              className="h-4 w-4 rounded border-primary-400/20 bg-surface-800/50 accent-primary-400"
            />
            Subscribe to updates
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-white/50">
            <input
              type="checkbox"
              checked={fields.remember}
              onChange={(e) => handleFieldChange(e.target.checked, 'remember')}
              className="h-4 w-4 rounded border-primary-400/20 bg-surface-800/50 accent-primary-400"
            />
            Remember me
          </label>
        </div>

        <div className="mt-6">
          <Button type="submit" variant="primary" fullWidth loading={isLoading}>
            {isLoading ? 'Validating...' : 'Continue'}
          </Button>
          <p className="mt-4 text-center text-xs text-white/25">
            Already have an account?{' '}
            <button type="button" onClick={onLogin} className="text-primary-300 transition-colors hover:text-primary-200">
              Sign in
            </button>
          </p>
        </div>
      </fieldset>
    </form>
  );
}

export default Step1;
