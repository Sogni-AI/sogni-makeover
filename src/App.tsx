import { useState, useEffect, useRef, useCallback } from 'react';
import { AppProvider, useApp } from '@/context/AppContext';
import { ToastProvider } from '@/context/ToastContext';
import { RewardsProvider, useRewards } from '@/context/RewardsContext';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import LandingHero from '@/components/landing/LandingHero';
import PhotoCapture from '@/components/capture/PhotoCapture';
import MakeoverStudio from '@/components/studio/MakeoverStudio';
import ComparisonView from '@/components/results/ComparisonView';
import HistoryView from '@/components/history/HistoryView';
import SessionTransferBanner from '@/components/auth/SessionTransferBanner';
import EmailVerificationModal from '@/components/auth/EmailVerificationModal';
import LoginModal, { LoginModalMode } from '@/components/auth/LoginModal';
import DailyBoostCelebration from '@/components/shared/DailyBoostCelebration';
import StripePurchase from '@/components/stripe/StripePurchase';
import Toast from '@/components/common/Toast';
import { captureReferralFromURL } from '@/utils/referralTracking';
import './App.css';

function AppContent() {
  const { currentView, authState } = useApp();
  const { rewards, loading: rewardsLoading, claimInProgress, lastClaimSuccess, claimRewardWithToken, resetClaimState, error: rewardsError } = useRewards();
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const [showDailyBoost, setShowDailyBoost] = useState(false);
  const [showStripePurchase, setShowStripePurchase] = useState(false);

  // Login/Signup modal state
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginModalMode, setLoginModalMode] = useState<LoginModalMode>('signup');

  const showSignupModal = useCallback((mode: LoginModalMode = 'signup') => {
    setLoginModalMode(mode);
    setShowLoginModal(true);
  }, []);

  const hideLoginModal = useCallback(() => {
    setShowLoginModal(false);
  }, []);

  // Capture referral parameter from URL on initial load
  useEffect(() => {
    captureReferralFromURL();
  }, []);

  // Auto-open signup modal when arriving with a referral code and not logged in
  const referralAutoOpenDone = useRef(false);
  useEffect(() => {
    if (authState.isLoading || authState.isAuthenticated) return;
    if (referralAutoOpenDone.current) return;
    const url = new URL(window.location.href);
    const hasReferralCode = url.searchParams.get('code') || url.searchParams.get('referral');
    if (hasReferralCode) {
      referralAutoOpenDone.current = true;
      showSignupModal('signup');
    }
  }, [authState.isLoading, authState.isAuthenticated, showSignupModal]);

  // Find the Daily Boost reward (id "2")
  const dailyBoostReward = rewards.find(r => r.id === '2');
  const canClaimDailyBoost = dailyBoostReward?.canClaim &&
    (!dailyBoostReward?.nextClaim || dailyBoostReward.nextClaim.getTime() <= Date.now());

  // Auto-show Daily Boost celebration when claimable
  useEffect(() => {
    if (!authState.isAuthenticated || rewardsLoading || rewards.length === 0) return;
    if (!canClaimDailyBoost) return;
    setShowDailyBoost(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState.isAuthenticated, rewardsLoading, rewards.length]);

  useEffect(() => {
    const handler = () => setShowEmailVerification(true);
    window.addEventListener('sogni-email-verification-required', handler);
    return () => window.removeEventListener('sogni-email-verification-required', handler);
  }, []);

  return (
    <div className="grain-overlay flex h-dvh flex-col overflow-hidden bg-surface-950 text-white">
      <Header
        onPurchaseClick={
          authState.isAuthenticated && authState.authMode === 'frontend'
            ? () => setShowStripePurchase(true)
            : undefined
        }
        onLoginClick={() => showSignupModal('login')}
        onSignupClick={() => showSignupModal('signup')}
      />
      {authState.sessionTransferred && authState.error && (
        <SessionTransferBanner message={authState.error} />
      )}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {currentView === 'landing' && <LandingHero />}
        {currentView === 'capture' && <PhotoCapture />}
        {currentView === 'studio' && <MakeoverStudio />}
        {currentView === 'results' && <ComparisonView />}
        {currentView === 'history' && <HistoryView />}
      </main>
      {(currentView === 'landing') && <Footer />}
      <EmailVerificationModal
        isOpen={showEmailVerification}
        onClose={() => setShowEmailVerification(false)}
      />
      <LoginModal
        open={showLoginModal}
        mode={loginModalMode}
        onModeChange={setLoginModalMode}
        onClose={hideLoginModal}
        onSignupComplete={hideLoginModal}
      />
      <DailyBoostCelebration
        isVisible={showDailyBoost}
        creditAmount={dailyBoostReward ? parseFloat(dailyBoostReward.amount) : 0}
        onClaim={(token) => {
          if (dailyBoostReward) {
            claimRewardWithToken(dailyBoostReward.id, token);
          }
        }}
        onDismiss={() => {
          setShowDailyBoost(false);
          resetClaimState();
        }}
        isClaiming={claimInProgress}
        claimSuccess={lastClaimSuccess}
        claimError={rewardsError}
      />
      {showStripePurchase && (
        <StripePurchase onClose={() => setShowStripePurchase(false)} />
      )}
      <Toast />
    </div>
  );
}

function App() {
  return (
    <ToastProvider>
      <AppProvider>
        <RewardsProvider>
          <AppContent />
        </RewardsProvider>
      </AppProvider>
    </ToastProvider>
  );
}

export default App;
