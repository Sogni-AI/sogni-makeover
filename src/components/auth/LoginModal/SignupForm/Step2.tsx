import { useCallback } from 'react';
import { Step1Fields, Step2Fields } from '../types';
import useForm from '@/hooks/useForm';
import Button from '@/components/common/Button';

function hasLetters(str: string) {
  return /[a-zA-Z]/.test(str);
}

function hasNumbers(str: string) {
  return /[0-9]/.test(str);
}

async function validate({ password, passwordConfirm }: Step2Fields) {
  const errors: Record<string, string> = {};

  if (!password) {
    errors.password = 'Password is required';
  } else if (password.length < 8) {
    errors.password = 'Password must be at least 8 characters';
  } else if (!hasLetters(password) || !hasNumbers(password)) {
    errors.password = 'Password must contain letters and numbers';
  }

  if (!passwordConfirm) {
    errors.passwordConfirm = 'Password confirm is required';
  } else if (password !== passwordConfirm) {
    errors.passwordConfirm = 'Passwords do not match';
  }

  return errors;
}

interface Props {
  step1: Step1Fields;
  initialState: Step2Fields;
  onContinue: (fields: Step2Fields) => void;
  onReturn: () => void;
}

function Step2({ step1, initialState, onContinue, onReturn }: Props) {
  const doSubmit = useCallback(
    (step2: Step2Fields) => {
      onContinue(step2);
      return Promise.resolve();
    },
    [onContinue]
  );

  const { fields, fieldErrors, error, handleFieldChange, handleFormSubmit, isLoading } = useForm(
    initialState,
    doSubmit,
    validate
  );

  return (
    <form onSubmit={handleFormSubmit} autoComplete="on">
      <fieldset disabled={isLoading} className="border-none p-0 m-0">
        {/* Hidden username field for password manager autofill */}
        <input
          type="text"
          name="username"
          id="signup-username-hidden"
          value={step1.username}
          autoComplete="username"
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          className="absolute -left-[9999px]"
        />

        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-primary-500 shadow-lg shadow-primary-400/20">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2 className="font-display text-xl font-bold text-white">Create Password</h2>
          <p className="mt-1 text-sm text-white/40">Choose a secure password for your account</p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-secondary-500/20 bg-secondary-500/8 px-3 py-2 text-sm text-secondary-400">
            {error.message}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label htmlFor="signup-password" className="mb-1.5 block text-sm font-medium text-white/50">
              Password
            </label>
            <input
              id="signup-password"
              type="password"
              value={fields.password}
              onChange={(e) => handleFieldChange(e.target.value, 'password')}
              placeholder="Minimum 8 characters"
              autoComplete="new-password"
              className={`w-full rounded-xl border bg-surface-800/50 px-4 py-2.5 text-sm text-white placeholder-white/25 outline-none transition-colors focus:bg-surface-800/80 ${
                fieldErrors.password ? 'border-secondary-500/40 focus:border-secondary-500/60' : 'border-primary-400/[0.08] focus:border-primary-400/25'
              }`}
            />
            {fieldErrors.password && <p className="mt-1 text-xs text-secondary-400">{fieldErrors.password}</p>}
          </div>

          <div>
            <label htmlFor="signup-password-confirm" className="mb-1.5 block text-sm font-medium text-white/50">
              Confirm Password
            </label>
            <input
              id="signup-password-confirm"
              type="password"
              value={fields.passwordConfirm}
              onChange={(e) => handleFieldChange(e.target.value, 'passwordConfirm')}
              placeholder="Re-enter your password"
              autoComplete="new-password"
              className={`w-full rounded-xl border bg-surface-800/50 px-4 py-2.5 text-sm text-white placeholder-white/25 outline-none transition-colors focus:bg-surface-800/80 ${
                fieldErrors.passwordConfirm ? 'border-secondary-500/40 focus:border-secondary-500/60' : 'border-primary-400/[0.08] focus:border-primary-400/25'
              }`}
            />
            {fieldErrors.passwordConfirm && <p className="mt-1 text-xs text-secondary-400">{fieldErrors.passwordConfirm}</p>}
          </div>
        </div>

        <div className="mt-6">
          <button
            type="button"
            onClick={onReturn}
            className="mb-3 block w-full text-center text-sm font-medium text-white/40 transition-colors hover:text-white/60"
          >
            &larr; Back
          </button>
          <Button type="submit" variant="primary" fullWidth loading={isLoading}>
            {isLoading ? 'Validating...' : 'Continue'}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

export default Step2;
