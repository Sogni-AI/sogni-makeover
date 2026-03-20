import { useState } from 'react';
import { motion } from 'framer-motion';
import { useApp } from '@/context/AppContext';
import Button from '@/components/common/Button';
import UserMenu from '@/components/layout/UserMenu';
import ReferralSharePopup from '@/components/shared/ReferralSharePopup';
import QualityTierSelect from '@/components/layout/QualityTierSelect';

interface HeaderProps {
  onPurchaseClick?: () => void;
  onLoginClick?: () => void;
  onSignupClick?: () => void;
}

function Header({ onPurchaseClick, onLoginClick, onSignupClick }: HeaderProps) {
  const { authState, currentView, setCurrentView } = useApp();
  const [showReferral, setShowReferral] = useState(false);

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      className="sticky top-0 z-50 w-full border-b border-primary-400/[0.06] bg-surface-950/80 backdrop-blur-xl"
    >
      <div className="flex h-16 items-center justify-between px-4 sm:px-6">
        <button
          onClick={() => setCurrentView('landing')}
          className="group flex items-center gap-2.5 transition-opacity hover:opacity-80"
        >
          {/* Geometric diamond logo mark */}
          <div className="relative flex h-8 w-8 items-center justify-center">
            <div className="absolute h-5 w-5 rotate-45 border border-primary-400/40 transition-colors group-hover:border-primary-400/70" />
            <div className="absolute h-2.5 w-2.5 rotate-45 bg-primary-400/60 transition-colors group-hover:bg-primary-400" />
          </div>
          <span className="text-lg tracking-wide">
            <span className="font-display text-xl font-semibold text-primary-300">
              Sogni
            </span>{' '}
            <span className="font-light text-white/60">Makeover</span>
          </span>
        </button>

        <nav className="flex items-center gap-3">
          {currentView !== 'landing' && (
            <>
              <motion.button
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => setCurrentView('landing')}
                className="text-sm text-white/40 transition-colors hover:text-primary-300"
              >
                Home
              </motion.button>
              <QualityTierSelect />
            </>
          )}

          {authState.isAuthenticated && (
            <button
              onClick={() => setShowReferral(true)}
              className="whitespace-nowrap rounded-full bg-gradient-to-r from-primary-400 to-primary-500 px-3 py-1 text-xs font-semibold text-surface-950 transition-all duration-200 hover:scale-105 hover:shadow-lg hover:shadow-primary-400/30"
            >
              Share & Earn
            </button>
          )}

          {authState.isAuthenticated ? (
            <UserMenu onPurchaseClick={onPurchaseClick} />
          ) : (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onLoginClick}
              >
                Log In
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={onSignupClick}
              >
                Sign Up
              </Button>
            </div>
          )}
        </nav>
      </div>
      <ReferralSharePopup isOpen={showReferral} onClose={() => setShowReferral(false)} />
    </motion.header>
  );
}

export default Header;
