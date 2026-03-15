import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LoginModalMode } from './types';
import LoginForm from './LoginForm';
import SignupForm from './SignupForm';

interface Props {
  open: boolean;
  mode: LoginModalMode;
  onModeChange: (mode: LoginModalMode) => void;
  onClose: () => void;
  onSignupComplete?: () => void;
}

function LoginModal({ open, mode, onModeChange, onClose, onSignupComplete }: Props) {
  const handleLogin = useCallback(() => onModeChange('login'), [onModeChange]);
  const handleSignup = useCallback(() => onModeChange('signup'), [onModeChange]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  const content = mode === 'login'
    ? <LoginForm onSignup={handleSignup} onClose={onClose} />
    : <SignupForm onLogin={handleLogin} onClose={onClose} onSignupComplete={onSignupComplete} />;

  const modalContent = (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100000] flex items-center justify-center p-4"
          style={{ background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(8px)' }}
          onClick={handleOverlayClick}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-primary-400/[0.08] bg-surface-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/60"
              onClick={onClose}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <div className="p-6">{content}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(modalContent, document.body);
}

export default LoginModal;
export type { LoginModalMode } from './types';
