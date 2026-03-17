import { useState } from 'react';
import { useSogniAuth } from '@/services/sogniAuth';
import urls from '@/config/urls';
import Modal from '@/components/common/Modal';

interface ReferralSharePopupProps {
  isOpen: boolean;
  onClose: () => void;
}

function ReferralSharePopup({ isOpen, onClose }: ReferralSharePopupProps) {
  const { user } = useSogniAuth();
  const [copied, setCopied] = useState(false);

  const referralUrl = user?.username
    ? `${urls.publicUrl}/?code=${encodeURIComponent(user.username)}`
    : '';

  const handleCopy = async () => {
    if (!referralUrl) return;
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[REFERRAL] Failed to copy:', err);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      {/* Header */}
      <div className="-mx-6 -mt-6 mb-5 border-b border-primary-400/[0.06] bg-gradient-to-br from-primary-400/[0.08] to-primary-500/[0.04] px-6 pb-5 pt-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-primary-400/20 to-primary-500/10">
          <svg className="h-6 w-6 text-primary-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        </div>
        <h2 className="font-display text-xl font-bold tracking-tight text-primary-300">
          Share & Earn
        </h2>
      </div>

      {/* Body */}
      <p className="mb-2 text-sm leading-relaxed text-white/60">
        Share <strong className="text-primary-300">makeover.sogni.ai</strong> and earn render credits!
      </p>

      <ul className="mb-5 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-white/60">
        <li>
          Friends who sign up with your link get{' '}
          <strong className="text-amber-300">25 bonus credits</strong>
        </li>
        <li>
          You earn <strong className="text-amber-300">25 credits</strong> after their first purchase
        </li>
        <li>
          You also earn a share of rewards on every credit purchase they make — or that their own referrals make
        </li>
      </ul>

      {/* Referral link */}
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-white/40">
        Your referral link
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          readOnly
          value={referralUrl}
          onClick={(e) => (e.target as HTMLInputElement).select()}
          className="min-w-0 flex-1 rounded-xl border border-primary-400/[0.08] bg-surface-800/50 px-3 py-2.5 text-[13px] text-white/70 outline-none"
        />
        <button
          onClick={handleCopy}
          className={`flex-shrink-0 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white transition-all duration-200 ${
            copied
              ? 'bg-emerald-500'
              : 'bg-gradient-to-r from-primary-400 to-primary-500 hover:shadow-lg hover:shadow-primary-400/20'
          }`}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Program link */}
      <div className="mt-4 text-center">
        <a
          href="https://docs.sogni.ai/rewards/referral-program-sogni-ambassador-rewards"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] font-medium text-primary-300 transition-colors hover:text-primary-200 hover:underline"
        >
          Learn about the Referral Program &rarr;
        </a>
      </div>
    </Modal>
  );
}

export default ReferralSharePopup;
