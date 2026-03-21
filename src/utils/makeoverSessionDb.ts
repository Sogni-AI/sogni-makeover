/**
 * IndexedDB session persistence for Sogni Makeover
 *
 * Stores a single active session record that is overwritten at each save point.
 * All operations are non-fatal: failures are logged with console.warn and
 * resolve to safe defaults so the caller can continue without crashing.
 */

import type { EditStep, EditMode, Gender } from '@/types';
import type { ChatMessage, PhotoAnalysis, GeneratedCategory } from '@/types/chat';

// --- Constants ---

const DB_NAME = 'sogni-makeover-db';
const DB_VERSION = 1;
const STORE_NAME = 'session';
const SESSION_KEY = 'active';

// --- Public interface ---

export interface PersistedSession {
  version: number;
  originalImageBase64: string;
  editStack: {
    steps: EditStep[];
    currentIndex: number;
    mode: EditMode;
  };
  chatMessages: ChatMessage[];
  photoAnalysis: PhotoAnalysis | null;
  generatedCategories: GeneratedCategory[];
  selectedGender: Gender | null;
  timestamp: number;
  /** Cached thumbnail URLs keyed by transformation ID or "__cat__" + category name */
  thumbnailCache?: Record<string, string>;
}

// --- Internal helper ---

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

// --- Public API ---

/**
 * Write or overwrite the active session record.
 */
export async function saveSession(data: PersistedSession): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(data, SESSION_KEY);

      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = (event) => { db.close(); reject((event.target as IDBTransaction).error); };
    });
  } catch (e) {
    console.warn('makeoverSessionDb: error saving session:', e);
  }
}

/**
 * Read the active session record.
 * Returns null if no session exists or if the stored version does not match.
 */
export async function loadSession(): Promise<PersistedSession | null> {
  try {
    const db = await openDb();
    const result = await new Promise<PersistedSession | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(SESSION_KEY);

      request.onsuccess = (event) => resolve((event.target as IDBRequest<PersistedSession>).result);
      request.onerror = (event) => reject((event.target as IDBRequest).error);

      tx.oncomplete = () => db.close();
      tx.onerror = (event) => reject((event.target as IDBTransaction).error);
    });

    if (!result) {
      return null;
    }

    if (result.version !== 1) {
      return null;
    }

    return result;
  } catch (e) {
    console.warn('makeoverSessionDb: error loading session:', e);
    return null;
  }
}

/**
 * Delete the active session record.
 */
export async function clearSession(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(SESSION_KEY);

      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = (event) => { db.close(); reject((event.target as IDBTransaction).error); };
    });
  } catch (e) {
    console.warn('makeoverSessionDb: error clearing session:', e);
  }
}

/**
 * Quick check whether an active session record exists.
 */
export async function hasSession(): Promise<boolean> {
  try {
    const db = await openDb();
    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.count(SESSION_KEY);

      request.onsuccess = (event) => resolve((event.target as IDBRequest<number>).result);
      request.onerror = (event) => reject((event.target as IDBRequest).error);

      tx.oncomplete = () => db.close();
      tx.onerror = (event) => reject((event.target as IDBTransaction).error);
    });
    return count > 0;
  } catch (e) {
    console.warn('makeoverSessionDb: error checking session existence:', e);
    return false;
  }
}
