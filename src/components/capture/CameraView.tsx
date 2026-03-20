import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import Button from '@/components/common/Button';

type CameraState = 'requesting' | 'active' | 'captured' | 'denied' | 'error';

function CameraView() {
  const {
    setOriginalImage,
    setCurrentView,
    settings,
    updateSetting,
    enhancePhoto,
    sogniClient,
    authState,
    isGenerating,
  } = useApp();
  const { addToast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startingRef = useRef(false);

  const [cameraState, setCameraState] = useState<CameraState>('requesting');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async (facing: 'user' | 'environment') => {
    // Guard: check for camera API availability
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('error');
      addToast('error', 'Camera is not supported in this browser. Please try uploading a photo instead.');
      return;
    }

    // Guard: prevent concurrent getUserMedia calls (Strict Mode double-mount)
    if (startingRef.current) return;
    startingRef.current = true;

    try {
      stopStream();

      // Request highest useful resolution — square crop so request
      // large square; iOS swaps width/height internally so we request
      // landscape-oriented and let the browser negotiate.
      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const requestWidth = isIOS ? 1920 : 2048;
      const requestHeight = isIOS ? 1080 : 2048;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: requestWidth },
          height: { ideal: requestHeight },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraState('active');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setCameraState('denied');
      } else {
        setCameraState('error');
        addToast('error', 'Unable to access camera. Please try uploading a photo instead.');
      }
    } finally {
      startingRef.current = false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    startCamera(facingMode);

    return () => {
      stopStream();
    };
  }, [facingMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const capturePhoto = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // Crop to 2:3 aspect ratio from the video's native resolution
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // Determine the largest 2:3 rectangle that fits inside the video
    let cropW: number, cropH: number;
    if (vw / vh > 2 / 3) {
      // Video is wider than 2:3 — height is the constraint
      cropH = vh;
      cropW = Math.round(vh * (2 / 3));
    } else {
      // Video is taller than (or exactly) 2:3 — width is the constraint
      cropW = vw;
      cropH = Math.round(vw * (3 / 2));
    }

    canvas.width = cropW;
    canvas.height = cropH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Enable high-quality resampling
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Fill black to prevent any transparency
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, cropW, cropH);

    // Center-crop from the video's native resolution
    const offsetX = (vw - cropW) / 2;
    const offsetY = (vh - cropH) / 2;

    if (facingMode === 'user') {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.translate(-cropW, 0);
    }

    ctx.drawImage(video, offsetX, offsetY, cropW, cropH, 0, 0, cropW, cropH);

    if (facingMode === 'user') {
      ctx.restore();
    }

    // iOS stability: redraw after a short delay
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS) {
      await new Promise(resolve => setTimeout(resolve, 100));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, cropW, cropH);
      if (facingMode === 'user') {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.translate(-cropW, 0);
      }
      ctx.drawImage(video, offsetX, offsetY, cropW, cropH, 0, 0, cropW, cropH);
      if (facingMode === 'user') {
        ctx.restore();
      }
    }

    // Two-step: lossless PNG first, then convert to JPEG for better quality
    const pngDataUrl = canvas.toDataURL('image/png', 1.0);

    // Convert PNG to high-quality JPEG
    const img = new Image();
    img.src = pngDataUrl;
    await new Promise<void>((resolve) => {
      img.onload = () => resolve();
    });

    canvas.width = cropW;
    canvas.height = cropH;
    const jpegCtx = canvas.getContext('2d');
    if (jpegCtx) {
      jpegCtx.drawImage(img, 0, 0);
    }
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

    setCapturedImage(dataUrl);
    setCameraState('captured');

    stopStream();
  }, [facingMode, stopStream]);

  const retake = useCallback(() => {
    setCapturedImage(null);
    setCameraState('requesting');
    startCamera(facingMode);
  }, [facingMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const usePhoto = useCallback(async () => {
    if (!capturedImage) return;

    const response = await fetch(capturedImage);
    const blob = await response.blob();
    const file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' });

    setOriginalImage(file);
    setCurrentView('studio');

    // Auto-enhance: run in background after navigating to studio
    if (settings.autoEnhanceWebcam) {
      // Extract raw base64 from the data URL
      const base64 = capturedImage.includes(',') ? capturedImage.split(',')[1] : capturedImage;

      enhancePhoto(base64, sogniClient, authState.isAuthenticated).then(async (result) => {
        if (!result) return;
        // Guard: don't replace if user already started a makeover
        if (isGenerating) return;

        try {
          const enhancedResponse = await fetch(result.imageUrl);
          const enhancedBlob = await enhancedResponse.blob();
          const enhancedFile = new File([enhancedBlob], 'enhanced-capture.jpg', { type: 'image/jpeg' });
          setOriginalImage(enhancedFile);
        } catch {
          // Graceful fallback: original image is already set
        }
      });
    }
  }, [capturedImage, settings.autoEnhanceWebcam]); // eslint-disable-line react-hooks/exhaustive-deps

  const flipCamera = useCallback(() => {
    setFacingMode(prev => (prev === 'user' ? 'environment' : 'user'));
  }, []);

  if (cameraState === 'denied') {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-primary-400/[0.08] bg-surface-900/40 p-8 text-center">
        <svg className="h-12 w-12 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
        <h3 className="mt-4 font-display text-lg font-medium">Camera Access Denied</h3>
        <p className="mt-2 text-sm text-white/35">
          Please allow camera access in your browser settings, or try uploading a photo instead.
        </p>
      </div>
    );
  }

  if (cameraState === 'error') {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-primary-400/[0.08] bg-surface-900/40 p-8 text-center">
        <svg className="h-12 w-12 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <h3 className="mt-4 font-display text-lg font-medium">Camera Unavailable</h3>
        <p className="mt-2 text-sm text-white/35">
          Your device camera could not be accessed. Please try uploading a photo instead.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-primary-400/10 bg-surface-950 max-h-[55dvh] sm:max-h-none">
        {cameraState === 'captured' && capturedImage ? (
          <motion.img
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            src={capturedImage}
            alt="Captured photo"
            className="aspect-[2/3] w-full object-cover"
          />
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`aspect-[2/3] w-full object-cover ${facingMode === 'user' ? 'camera-mirror' : ''}`}
            />
            {cameraState === 'requesting' && (
              <div className="absolute inset-0 flex items-center justify-center bg-surface-950">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-400/20 border-t-primary-400" />
                  <p className="text-sm text-white/35">Starting camera...</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />

      <div className="mt-4 flex items-center gap-3 pb-2">
        {cameraState === 'captured' ? (
          <>
            <Button variant="outline" onClick={retake}>
              Retake
            </Button>
            <Button variant="primary" onClick={usePhoto}>
              Use This Photo
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={flipCamera}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
              </svg>
              Flip
            </Button>
            <button
              onClick={capturePhoto}
              disabled={cameraState !== 'active'}
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-primary-400/25 bg-white transition-all hover:scale-105 hover:border-primary-400/50 active:scale-95 disabled:opacity-30"
              aria-label="Capture photo"
            >
              <div className="h-12 w-12 rounded-full bg-white" />
            </button>
            <div className="w-[68px]" />
          </>
        )}
      </div>

      {/* Auto-enhance toggle */}
      {cameraState !== 'captured' && (
        <div className="pb-2">
          <button
            onClick={() => updateSetting('autoEnhanceWebcam', !settings.autoEnhanceWebcam)}
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-white/40 transition-colors hover:text-white/60"
          >
            <span
              className={`inline-block h-2 w-2 rounded-full transition-colors ${
                settings.autoEnhanceWebcam ? 'bg-green-400' : 'bg-white/20'
              }`}
            />
            Auto-enhance {settings.autoEnhanceWebcam ? 'on' : 'off'}
          </button>
        </div>
      )}
    </div>
  );
}

export default CameraView;
