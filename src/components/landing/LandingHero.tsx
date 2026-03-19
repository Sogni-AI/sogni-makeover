import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '@/context/AppContext';
import type { Gender } from '@/types';
import Button from '@/components/common/Button';
import { VenusIcon, MarsIcon } from './GenderIcons';
import {
  QWEN_LIGHTNING_MODEL_ID,
  QWEN_STANDARD_MODEL_ID,
  FLUX2_DEV_MODEL_ID,
} from '@/constants/settings';
import { useSogniAuth } from '@/services/sogniAuth';
import { useWallet } from '@/hooks/useWallet';
import { useQualityTierCosts } from '@/hooks/useQualityTierCosts';

type ImagePair = { before: string; after: string };

const femalePairs: ImagePair[] = [
  { before: '/images/before1.png', after: '/images/after1.png' },
  { before: '/images/before3.png', after: '/images/after3.png' },
  { before: '/images/before4.png', after: '/images/after4.png' },
  { before: '/images/before5.png', after: '/images/after5.png' },
  { before: '/images/before9.png', after: '/images/after9.png' },
];

const malePairs: ImagePair[] = [
  { before: '/images/before2.png', after: '/images/after2.png' },
  { before: '/images/before6.png', after: '/images/after6.png' },
  { before: '/images/before7.png', after: '/images/after7.png' },
  { before: '/images/before8.png', after: '/images/after8.png' },
];

// Interleave female/male so keyboard navigation alternates genders
const allPairs: ImagePair[] = [];
for (let i = 0; i < Math.max(femalePairs.length, malePairs.length); i++) {
  if (i < femalePairs.length) allPairs.push(femalePairs[i]);
  if (i < malePairs.length) allPairs.push(malePairs[i]);
}

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  },
};

const QUALITY_TIERS = [
  { label: 'Make it fast!', modelId: QWEN_LIGHTNING_MODEL_ID },
  { label: 'Good looks take time.', modelId: QWEN_STANDARD_MODEL_ID },
  { label: 'Pro Tier Quality', modelId: FLUX2_DEV_MODEL_ID },
] as const;

function LandingHero() {
  const { setCurrentView, setSelectedGender, settings, updateSetting } = useApp();
  const { isAuthenticated, authMode } = useSogniAuth();
  const { tokenType } = useWallet();
  const tierCosts = useQualityTierCosts();
  const isLoggedIn = isAuthenticated && authMode !== 'demo';
  const costLabel = tokenType === 'sogni' ? 'Sogni' : 'Spark';
  const [step, setStep] = useState<'idle' | 'gender' | 'quality'>('idle');
  const [pendingGender, setPendingGender] = useState<Gender | null>(null);
  const [hoveredGender, setHoveredGender] = useState<Gender | null>(null);

  // Portrait slideshow state
  const [portraitDisplay, setPortraitDisplay] = useState({
    layers: [
      { before: femalePairs[0].before, after: femalePairs[0].after },
      { before: femalePairs[0].before, after: femalePairs[0].after },
    ] as [ImagePair, ImagePair],
    activeLayer: 0 as 0 | 1,
  });
  const lastGenderRef = useRef<'female' | 'male'>('female');
  const shuffleBagRef = useRef<Record<string, number[]>>({ female: [], male: [] });
  const hoverIndexRef = useRef<Record<string, number>>({ female: 0, male: 0 });
  const keyboardIndexRef = useRef(0);
  const keyboardGenderIndexRef = useRef(0);
  const hoveredGenderRef = useRef<Gender | null>(null);
  const prevHoveredGenderRef = useRef<Gender | null>(null);
  const [idleResetKey, setIdleResetKey] = useState(0);

  const transitionTo = useCallback((pair: ImagePair) => {
    setPortraitDisplay(prev => {
      const inactive = prev.activeLayer === 0 ? 1 : 0;
      const newLayers = [...prev.layers] as [ImagePair, ImagePair];
      newLayers[inactive] = pair;
      return { layers: newLayers, activeLayer: inactive as 0 | 1 };
    });
  }, []);

  const pickNextPair = useCallback((gender: 'female' | 'male', lastShown?: number): ImagePair => {
    const pairs = gender === 'female' ? femalePairs : malePairs;
    let bag = shuffleBagRef.current[gender];
    if (bag.length === 0) {
      // Refill: all indices, shuffled (Fisher-Yates)
      bag = Array.from({ length: pairs.length }, (_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      // Avoid repeating the last-shown pair across reshuffles
      if (bag[0] === lastShown && bag.length > 1) {
        const swapIdx = 1 + Math.floor(Math.random() * (bag.length - 1));
        [bag[0], bag[swapIdx]] = [bag[swapIdx], bag[0]];
      }
      shuffleBagRef.current[gender] = bag;
    }
    const nextIdx = bag.shift()!;
    return pairs[nextIdx];
  }, []);

  // Keep hoveredGenderRef in sync so keyboard handler can read it
  useEffect(() => {
    hoveredGenderRef.current = hoveredGender;
    keyboardGenderIndexRef.current = 0;
  }, [hoveredGender]);

  // Keyboard arrow navigation for portrait slideshow
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      const hGender = hoveredGenderRef.current;

      if (hGender) {
        // Gender-specific: only cycle through hovered gender's pairs
        const pairs = hGender === 'female' ? femalePairs : malePairs;
        const len = pairs.length;
        keyboardGenderIndexRef.current = (keyboardGenderIndexRef.current + delta + len) % len;
        transitionTo(pairs[keyboardGenderIndexRef.current]);
        lastGenderRef.current = hGender;
      } else {
        // Idle: cycle through interleaved pairs (alternating genders)
        const len = allPairs.length;
        keyboardIndexRef.current = (keyboardIndexRef.current + delta + len) % len;
        const pair = allPairs[keyboardIndexRef.current];
        transitionTo(pair);
        // Determine gender of current pair for idle rotation continuity
        lastGenderRef.current = femalePairs.includes(pair) ? 'female' : 'male';
      }
      // Reset idle timer
      setIdleResetKey(k => k + 1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Portrait rotation effect
  useEffect(() => {
    if (hoveredGender) {
      const pairs = hoveredGender === 'female' ? femalePairs : malePairs;

      // Only show immediate transition when hoveredGender actually changed,
      // not when re-triggered by keyboard reset (idleResetKey)
      if (prevHoveredGenderRef.current !== hoveredGender) {
        const idx = hoverIndexRef.current[hoveredGender] % pairs.length;
        transitionTo(pairs[idx]);
        hoverIndexRef.current[hoveredGender] = idx + 1;
      }
      prevHoveredGenderRef.current = hoveredGender;
      lastGenderRef.current = hoveredGender;

      // Rotate through same-gender pairs sequentially
      const interval = setInterval(() => {
        const nextIdx = hoverIndexRef.current[hoveredGender] % pairs.length;
        transitionTo(pairs[nextIdx]);
        hoverIndexRef.current[hoveredGender] = nextIdx + 1;
      }, 5000);
      return () => clearInterval(interval);
    }

    prevHoveredGenderRef.current = null;

    // Idle mode: alternate genders
    const lastShown: Record<string, number> = { female: 0, male: -1 };
    const interval = setInterval(() => {
      const nextGender = lastGenderRef.current === 'female' ? 'male' : 'female';
      const pair = pickNextPair(nextGender, lastShown[nextGender]);
      const pairs = nextGender === 'female' ? femalePairs : malePairs;
      lastShown[nextGender] = pairs.indexOf(pair);
      transitionTo(pair);
      lastGenderRef.current = nextGender;
    }, 5000);
    return () => clearInterval(interval);
  }, [hoveredGender, idleResetKey]); // eslint-disable-line react-hooks/exhaustive-deps


  const handleSelectGender = (gender: Gender) => {
    setPendingGender(gender);
    setStep('quality');
  };

  const handleSelectQuality = (modelId: string) => {
    if (pendingGender) setSelectedGender(pendingGender);
    updateSetting('defaultModel', modelId);
    setCurrentView('capture');
  };

  return (
    <section className="relative flex h-full flex-col overflow-hidden">
      {/* Background ambient lighting */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/3 top-1/3 h-[500px] w-[500px] rounded-full bg-primary-400/[0.03] blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/3 h-[400px] w-[400px] rounded-full bg-secondary-400/[0.02] blur-[100px]" />
        {/* Decorative geometric lines */}
        <div className="absolute left-8 top-1/4 h-px w-32 bg-gradient-to-r from-transparent via-primary-400/15 to-transparent sm:left-16 sm:w-48" />
        <div className="absolute bottom-1/3 right-8 h-px w-32 bg-gradient-to-r from-transparent via-primary-400/10 to-transparent sm:right-16 sm:w-48" />
        <div className="absolute left-1/4 top-16 h-32 w-px bg-gradient-to-b from-transparent via-primary-400/8 to-transparent" />
      </div>

      {/* Before/After portrait images - mirrored flanking portraits */}
      <motion.div
        initial={{ opacity: 0, x: -40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
        className="pointer-events-none absolute -left-3 top-0 h-full w-[45%] opacity-[0.08] sm:w-[44%] md:w-[44%] md:opacity-25 lg:-left-[calc(5%+10px)] lg:w-[38%] lg:opacity-100 xl:w-[35%]"
        style={{
          maskImage: 'linear-gradient(to right, black 0%, black 98%, transparent 100%), linear-gradient(to top, transparent 0%, black 15%, black 85%, transparent 100%)',
          maskComposite: 'intersect',
          WebkitMaskImage: 'linear-gradient(to right, black 0%, black 98%, transparent 100%), linear-gradient(to top, transparent 0%, black 15%, black 85%, transparent 100%)',
          WebkitMaskComposite: 'source-in',
        }}
      >
        {portraitDisplay.layers.map((layer, i) => (
          <div
            key={i}
            className="absolute inset-0 transition-[opacity,transform] duration-700 ease-in-out"
            style={{
              backgroundImage: `url(${layer.before})`,
              backgroundSize: 'auto 100%',
              backgroundPosition: 'right center',
              backgroundRepeat: 'no-repeat',
              filter: 'sepia(0.15) saturate(0.85) brightness(0.9)',
              opacity: portraitDisplay.activeLayer === i ? 0.7 : 0,
              transform: portraitDisplay.activeLayer === i ? undefined : 'translateX(-20px)',
            }}
          />
        ))}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.5 }}
        className="pointer-events-none absolute -right-3 top-0 h-full w-[45%] opacity-[0.08] sm:w-[44%] md:w-[44%] md:opacity-25 lg:-right-[calc(5%+10px)] lg:w-[38%] lg:opacity-100 xl:w-[35%]"
        style={{
          maskImage: 'linear-gradient(to left, black 0%, black 98%, transparent 100%), linear-gradient(to top, transparent 0%, black 15%, black 85%, transparent 100%)',
          maskComposite: 'intersect',
          WebkitMaskImage: 'linear-gradient(to left, black 0%, black 98%, transparent 100%), linear-gradient(to top, transparent 0%, black 15%, black 85%, transparent 100%)',
          WebkitMaskComposite: 'source-in',
        }}
      >
        {portraitDisplay.layers.map((layer, i) => (
          <div
            key={i}
            className="absolute inset-0 transition-[opacity,transform] duration-700 ease-in-out"
            style={{
              backgroundImage: `url(${layer.after})`,
              backgroundSize: 'auto 100%',
              backgroundPosition: 'left center',
              backgroundRepeat: 'no-repeat',
              filter: 'sepia(0.08) saturate(1.0) brightness(0.9)',
              opacity: portraitDisplay.activeLayer === i ? 0.75 : 0,
              transform: portraitDisplay.activeLayer === i ? undefined : 'translateX(20px)',
            }}
          />
        ))}
      </motion.div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-4 sm:px-6 lg:px-8"
      >
        <div className="text-center">
          {/* Pill badge with mascot */}
          <motion.div variants={itemVariants} className="flex flex-col items-center">
            {/* Mascot peeking from behind pill */}
            <motion.div
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 1.0, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              className="h-[110px] overflow-hidden pointer-events-none sm:h-[140px] lg:h-[180px]"
            >
              <img
                src="/images/mascot.png"
                alt="Sogni Makeover mascot"
                className="h-auto w-[140px] sm:w-[180px] lg:w-[220px]"
              />
            </motion.div>

            <span className="relative z-10 inline-flex items-center gap-2 rounded-full border border-primary-400/15 bg-primary-400/[0.04] px-4 py-1.5 text-sm tracking-wide text-primary-300/80">
              <span className="h-1 w-1 rounded-full bg-primary-400/60" />
              Your AI-Powered Atelier
            </span>
          </motion.div>

          {/* Hero heading - editorial serif */}
          <motion.h1
            variants={itemVariants}
            className="mt-4 font-display text-5xl font-medium tracking-tight sm:text-6xl lg:mt-8 lg:text-8xl"
          >
            <span className="block text-white/90">Transform Your</span>
            <span className="mt-1 block font-display italic">
              <span className="gradient-text">Look with AI</span>
            </span>
          </motion.h1>

          {/* Decorative line */}
          <motion.div variants={itemVariants} className="mx-auto mt-3 flex items-center justify-center gap-3 lg:mt-6">
            <div className="h-px w-12 bg-gradient-to-r from-transparent to-primary-400/30" />
            <div className="h-1.5 w-1.5 rotate-45 border border-primary-400/40" />
            <div className="h-px w-12 bg-gradient-to-l from-transparent to-primary-400/30" />
          </motion.div>

          <motion.p
            variants={itemVariants}
            className="mx-auto mt-3 max-w-lg text-base font-light leading-relaxed text-white/40 sm:text-lg lg:mt-6"
          >
            Try new hairstyles, makeup, and styles instantly.
            See how you look before making any real changes.
          </motion.p>

          <motion.div variants={itemVariants} className="mt-6 flex flex-col items-center gap-4 lg:mt-10">
            <AnimatePresence mode="wait">
              {step === 'idle' ? (
                <motion.div
                  key="start-button"
                  initial={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.3 } }}
                  className="flex flex-col items-center gap-4"
                >
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={() => setStep('gender')}
                    className="text-lg shadow-xl shadow-primary-400/10"
                  >
                    Start Your Makeover
                  </Button>
                  <p className="text-sm font-light tracking-wide text-white/20">
                    No sign-up required &bull; Free to try
                  </p>
                </motion.div>
              ) : step === 'gender' ? (
                <motion.div
                  key="gender-select"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } }}
                  exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.3 } }}
                  className="flex items-center gap-8 sm:gap-12"
                >
                  {/* Female icon */}
                  <motion.button
                    aria-label="Female"
                    initial={{ x: 30, opacity: 0 }}
                    animate={{ x: 0, opacity: 1, transition: { delay: 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] } }}
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.95 }}
                    onHoverStart={() => setHoveredGender('female')}
                    onHoverEnd={() => setHoveredGender(null)}
                    onClick={() => handleSelectGender('female')}
                    className="group relative flex h-20 w-20 items-center justify-center rounded-full border border-primary-400/20 bg-surface-900/60 backdrop-blur-sm transition-all duration-300 hover:border-primary-400/40 hover:bg-primary-400/[0.08] hover:shadow-lg hover:shadow-primary-400/10 sm:h-24 sm:w-24 cursor-pointer"
                  >
                    <VenusIcon className="h-10 w-10 text-white/50 transition-colors duration-300 group-hover:text-primary-300 sm:h-12 sm:w-12" />
                    <span className="absolute -bottom-6 text-[10px] font-light uppercase tracking-[0.15em] text-white/0 transition-all duration-300 group-hover:text-white/40">femme</span>
                  </motion.button>

                  {/* Divider */}
                  <div className="h-12 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent" />

                  {/* Male icon */}
                  <motion.button
                    aria-label="Male"
                    initial={{ x: -30, opacity: 0 }}
                    animate={{ x: 0, opacity: 1, transition: { delay: 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1] } }}
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.95 }}
                    onHoverStart={() => setHoveredGender('male')}
                    onHoverEnd={() => setHoveredGender(null)}
                    onClick={() => handleSelectGender('male')}
                    className="group relative flex h-20 w-20 items-center justify-center rounded-full border border-primary-400/20 bg-surface-900/60 backdrop-blur-sm transition-all duration-300 hover:border-primary-400/40 hover:bg-primary-400/[0.08] hover:shadow-lg hover:shadow-primary-400/10 sm:h-24 sm:w-24 cursor-pointer"
                  >
                    <MarsIcon className="h-10 w-10 text-white/50 transition-colors duration-300 group-hover:text-primary-300 sm:h-12 sm:w-12" />
                    <span className="absolute -bottom-6 text-[10px] font-light uppercase tracking-[0.15em] text-white/0 transition-all duration-300 group-hover:text-white/40">homme</span>
                  </motion.button>
                </motion.div>
              ) : (
                <motion.div
                  key="quality-select"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } }}
                  className="flex flex-col items-center gap-3"
                >
                  {QUALITY_TIERS.map((tier, i) => {
                    const isCurrentDefault = settings.defaultModel === tier.modelId;
                    return (
                      <motion.button
                        key={tier.modelId}
                        aria-label={`Quality: ${tier.label}`}
                        aria-pressed={isCurrentDefault}
                        initial={{ y: 20, opacity: 0 }}
                        animate={{
                          y: 0,
                          opacity: 1,
                          transition: { delay: 0.1 + i * 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] },
                        }}
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => handleSelectQuality(tier.modelId)}
                        className={`relative flex w-64 items-center justify-center rounded-full border px-6 py-3 text-sm font-light tracking-wide backdrop-blur-sm transition-all duration-300 cursor-pointer sm:w-72 ${
                          isCurrentDefault
                            ? 'border-primary-400/40 bg-primary-400/[0.08] text-white/80 shadow-lg shadow-primary-400/10'
                            : 'border-primary-400/15 bg-surface-900/60 text-white/50 hover:border-primary-400/30 hover:bg-primary-400/[0.05] hover:text-white/70'
                        }`}
                      >
                        <span>{tier.label}</span>
                        {isLoggedIn && tierCosts[tier.modelId] != null && (
                          <span className={`ml-2 text-[10px] tracking-widest ${isCurrentDefault ? 'text-primary-300/50' : 'text-white/25'}`}>
                            {tierCosts[tier.modelId]} {costLabel}
                          </span>
                        )}
                      </motion.button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </motion.div>
    </section>
  );
}

export default LandingHero;
