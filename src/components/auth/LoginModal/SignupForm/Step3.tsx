import { useCallback, useState } from 'react';
import Turnstile from 'react-turnstile';
import { Step1Fields, Step2Fields } from '../types';
import { useSogniAuth } from '@/services/sogniAuth';
import { clearReferralSource } from '@/utils/referralTracking';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_KEY || '0x4AAAAAAAx5VThz0lTCgKRb';

interface Props {
  step1: Step1Fields;
  step2: Step2Fields;
  onReturn: () => void;
  onContinue: () => void;
}

function Step3({ step1, step2, onReturn, onContinue }: Props) {
  const { ensureClient, setAuthenticatedState } = useSogniAuth();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const doSignup = useCallback(async (token: string) => {
    setIsCreating(true);
    setError(null);

    try {
      const { username, email, subscribe, referralCode, remember } = step1;
      const { password } = step2;

      const client = await ensureClient();

      await client.account.create(
        {
          username,
          email,
          password,
          subscribe,
          referralCode: referralCode || 'MAKEOVER',
          turnstileToken: token
        },
        remember
      );

      console.log('[AUTH] Account created successfully', { username, email });

      if (remember) {
        localStorage.setItem('sogni-persist', 'true');
      } else {
        localStorage.removeItem('sogni-persist');
      }

      setAuthenticatedState(username, email);
      clearReferralSource();
      onContinue();
    } catch (err) {
      console.error('[AUTH] Signup failed:', err);
      setError(err instanceof Error ? err : new Error('Account creation failed'));
      setTurnstileToken(null);
      setIsCreating(false);
    }
  }, [step1, step2, ensureClient, setAuthenticatedState, onContinue]);

  const handleTurnstileVerify = useCallback((token: string) => {
    setTurnstileToken(token);
    doSignup(token);
  }, [doSignup]);

  return (
    <div>
      {/* Header */}
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-primary-500 shadow-lg shadow-primary-400/20">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <h2 className="font-display text-xl font-bold text-white">
          {isCreating ? 'Creating Account...' : 'Verify to Continue'}
        </h2>
        <p className="mt-1 text-sm text-white/40">
          {isCreating ? 'Please wait while we set up your account' : 'Complete the verification below'}
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-secondary-500/20 bg-secondary-500/8 px-3 py-2 text-sm text-secondary-400">
          {error.message}
        </div>
      )}

      {isCreating ? (
        <div className="py-8 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-transparent border-t-primary-400 border-r-primary-400/30"></div>
          <p className="mt-4 text-sm text-white/40">Please wait while we create your account...</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 py-4">
          {!turnstileToken && (
            <Turnstile
              sitekey={TURNSTILE_SITE_KEY}
              onVerify={handleTurnstileVerify}
              onError={() => setError(new Error('Verification failed. Please try again.'))}
              onExpire={() => {
                setTurnstileToken(null);
                setError(new Error('Verification expired. Please try again.'));
              }}
            />
          )}
        </div>
      )}

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={onReturn}
          disabled={isCreating}
          className="text-sm font-medium text-white/40 transition-colors hover:text-white/60 disabled:opacity-50"
        >
          &larr; Back
        </button>
      </div>
    </div>
  );
}

export default Step3;
