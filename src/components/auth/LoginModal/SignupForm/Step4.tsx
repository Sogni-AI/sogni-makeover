import { useEffect, useRef } from 'react';
import { useSogniAuth } from '@/services/sogniAuth';
import Button from '@/components/common/Button';

interface Props {
  onClose: () => void;
  onSignupComplete?: () => void;
}

function Step4({ onClose, onSignupComplete }: Props) {
  const { user, isAuthenticated } = useSogniAuth();
  const hasTriggeredCallback = useRef(false);

  useEffect(() => {
    if (isAuthenticated && user && !hasTriggeredCallback.current) {
      hasTriggeredCallback.current = true;

      const timer = setTimeout(() => {
        onClose();

        if (onSignupComplete) {
          setTimeout(() => {
            onSignupComplete();
          }, 100);
        }
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, user, onClose, onSignupComplete]);

  return (
    <div>
      {/* Header */}
      <div className="mb-6 text-center">
        <h2 className="font-display text-xl font-bold text-white">
          Welcome, <span className="gradient-text">@{user?.username}</span>!
        </h2>
      </div>

      <div className="py-6 text-center">
        {/* Success Icon */}
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full border-2 border-green-500/30 bg-green-500/10">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h3 className="mb-2 text-xl font-bold text-white">
          Account Created Successfully!
        </h3>
        <p className="mb-4 text-sm text-white/40">
          Check your email to verify your account and claim free credits.
        </p>
        {/* Bonus badge */}
        <div className="inline-flex items-center gap-2 rounded-full border border-primary-400/10 bg-primary-400/5 px-4 py-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary-400">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
          </svg>
          <span className="text-sm font-semibold text-white">
            50 FREE Daily Credits!
          </span>
        </div>
      </div>

      <div className="mt-6">
        <Button type="button" variant="primary" fullWidth onClick={onClose}>
          Get Started
        </Button>
      </div>
    </div>
  );
}

export default Step4;
