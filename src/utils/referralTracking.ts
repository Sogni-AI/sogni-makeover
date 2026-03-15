/**
 * Referral Tracking System
 * Captures referral codes from URL parameters and stores them in localStorage
 * with a 30-day attribution window.
 */

const REFERRAL_SOURCE_KEY = 'sogni_referral_source';
const REFERRAL_TIMESTAMP_KEY = 'sogni_referral_timestamp';
const ATTRIBUTION_EXPIRY_DAYS = 30;

const VALID_REFERRAL_PATTERN = /^[a-zA-Z0-9_.-]{1,50}$/;

/**
 * Capture referral parameter from the current URL and store it.
 * Call this once on app load.
 */
export function captureReferralFromURL(): void {
  try {
    const url = new URL(window.location.href);
    const referralParam = url.searchParams.get('code') || url.searchParams.get('referral');

    if (referralParam && VALID_REFERRAL_PATTERN.test(referralParam)) {
      console.log(`[REFERRAL] Referral parameter detected: ${referralParam}`);
      setReferralSource(referralParam);
    } else if (referralParam) {
      console.warn(`[REFERRAL] Invalid referral parameter rejected: ${referralParam}`);
    }
  } catch (error) {
    console.error('[REFERRAL] Failed to capture referral from URL:', error);
  }
}

/**
 * Store the referring user's username.
 */
export function setReferralSource(referralUsername: string): void {
  try {
    localStorage.setItem(REFERRAL_SOURCE_KEY, referralUsername);
    localStorage.setItem(REFERRAL_TIMESTAMP_KEY, Date.now().toString());
  } catch (error) {
    console.error('[REFERRAL] Failed to set referral source:', error);
  }
}

/**
 * Get stored referral source if within the 30-day attribution window.
 * Returns the referring username or null if expired/not set.
 */
export function getReferralSource(): string | null {
  try {
    const source = localStorage.getItem(REFERRAL_SOURCE_KEY);
    const timestamp = localStorage.getItem(REFERRAL_TIMESTAMP_KEY);

    if (!source || !timestamp) {
      return null;
    }

    const parsedTimestamp = Number(timestamp);
    if (isNaN(parsedTimestamp)) {
      clearReferralSource();
      return null;
    }

    const timeSinceAttribution = Date.now() - parsedTimestamp;
    const expiryMs = ATTRIBUTION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

    if (timeSinceAttribution > expiryMs) {
      clearReferralSource();
      return null;
    }

    return source;
  } catch (error) {
    console.error('[REFERRAL] Failed to get referral source:', error);
    return null;
  }
}

/**
 * Clear stored referral source (e.g., after conversion).
 */
export function clearReferralSource(): void {
  try {
    localStorage.removeItem(REFERRAL_SOURCE_KEY);
    localStorage.removeItem(REFERRAL_TIMESTAMP_KEY);
  } catch (error) {
    console.error('[REFERRAL] Failed to clear referral source:', error);
  }
}
