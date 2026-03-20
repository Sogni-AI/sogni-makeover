import { useState } from 'react';
import { motion } from 'framer-motion';
import CameraView from '@/components/capture/CameraView';
import PhotoUpload from '@/components/capture/PhotoUpload';
import SamplePhotos from '@/components/capture/SamplePhotos';
import DemoBanner from '@/components/auth/DemoBanner';
import { useApp } from '@/context/AppContext';

type CaptureTab = 'camera' | 'upload';

function PhotoCapture() {
  const [activeTab, setActiveTab] = useState<CaptureTab>('upload');
  const { authState, demoGenerationsRemaining } = useApp();

  return (
    <section className={`mx-auto max-w-3xl px-4 sm:px-6 sm:py-6 ${activeTab === 'camera' ? 'py-2' : 'py-4'}`}>
      {!authState.isAuthenticated && (
        <DemoBanner generationsRemaining={demoGenerationsRemaining} />
      )}

      {activeTab !== 'camera' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="text-center"
        >
          <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
            <span className="text-white/90">Begin Your </span>
            <span className="font-display italic text-primary-300">Transformation</span>
          </h1>
          <p className="mt-2 text-sm font-light text-white/35">
            Use your camera or upload an existing photo
          </p>
        </motion.div>
      )}

      {/* Tab switcher */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="mt-5 flex justify-center"
      >
        <div className="inline-flex rounded-xl border border-primary-400/[0.08] bg-surface-900/50 p-1">
          <button
            onClick={() => setActiveTab('camera')}
            className={`flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium transition-all ${
              activeTab === 'camera'
                ? 'bg-primary-400/10 text-primary-300 shadow-sm'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
            </svg>
            Camera
          </button>
          <button
            onClick={() => setActiveTab('upload')}
            className={`flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium transition-all ${
              activeTab === 'upload'
                ? 'bg-primary-400/10 text-primary-300 shadow-sm'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            Upload
          </button>
        </div>
      </motion.div>

      {/* Tab content */}
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mt-5"
      >
        {activeTab === 'camera' ? <CameraView /> : <PhotoUpload />}
      </motion.div>

      {activeTab !== 'camera' && <SamplePhotos />}
    </section>
  );
}

export default PhotoCapture;
