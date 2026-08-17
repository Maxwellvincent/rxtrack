// ── focus-hud link ──────────────────────────────────────────────────────────
// RXTrack and focus-hud are separate Firebase projects, so writing a signal
// into focus-hud means talking to a second project: a second app instance, its
// own auth session, and its own user id.
//
// That session is per-origin and persists, so the Google popup appears once and
// then never again on this machine.

import { getApp, getApps, initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const APP_NAME = "focus-hud";

const cfg = {
  apiKey: import.meta.env.VITE_FOCUSHUD_API_KEY,
  authDomain: import.meta.env.VITE_FOCUSHUD_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FOCUSHUD_PROJECT_ID,
  appId: import.meta.env.VITE_FOCUSHUD_APP_ID,
};

export const isFocusHudConfigured = !!(cfg.apiKey && cfg.projectId);

function app() {
  if (!isFocusHudConfigured) return null;
  return getApps().some((a) => a.name === APP_NAME)
    ? getApp(APP_NAME)
    : initializeApp(cfg, APP_NAME);
}

export function focusHudAuth() {
  const instance = app();
  return instance ? getAuth(instance) : null;
}

export function focusHudDb() {
  const instance = app();
  return instance ? getFirestore(instance) : null;
}

/** The focus-hud user id, or null when not linked yet. */
export function focusHudUserId() {
  return focusHudAuth()?.currentUser?.uid ?? null;
}

/**
 * Links this browser to focus-hud.
 *
 * Must be called from a click: browsers block popups that no gesture asked for.
 */
export async function connectFocusHud() {
  const auth = focusHudAuth();
  if (!auth) return { ok: false, reason: "not-configured" };

  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    return { ok: true, uid: result.user.uid };
  } catch (error) {
    return { ok: false, reason: error?.code ?? "failed" };
  }
}

export async function disconnectFocusHud() {
  const auth = focusHudAuth();
  if (auth) await signOut(auth);
}

/** Notifies when the link is established or lost. */
export function onFocusHudUser(callback) {
  const auth = focusHudAuth();
  if (!auth) return () => {};
  return onAuthStateChanged(auth, (user) => callback(user?.uid ?? null));
}
