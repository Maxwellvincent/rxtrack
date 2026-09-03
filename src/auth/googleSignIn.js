export const GOOGLE_POPUP_TIMEOUT_MS = 7000;

const REDIRECT_FALLBACK_CODES = new Set([
  "auth/popup-blocked",
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
  "auth/web-storage-unavailable",
  "auth/operation-not-supported-in-this-environment",
  "auth/popup-timeout",
]);

/** Start Google auth without allowing an invisible popup attempt to hang forever. */
export async function startGoogleSignIn({
  auth,
  provider,
  popup,
  redirect,
  preferRedirect = false,
  timeoutMs = GOOGLE_POPUP_TIMEOUT_MS,
}) {
  // A full-page redirect avoids popup cleanup races caused by COOP. In
  // particular, Firebase may have authenticated successfully while its popup
  // promise is still waiting to close; racing that promise with our timeout
  // used to start a second auth attempt and strand the shell signed out.
  if (preferRedirect) {
    await redirect(auth, provider);
    return;
  }

  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error("The Google sign-in window did not open.");
        error.code = "auth/popup-timeout";
        reject(error);
      }, timeoutMs);
    });
    await Promise.race([popup(auth, provider), timeout]);
  } catch (error) {
    if (!REDIRECT_FALLBACK_CODES.has(error?.code)) throw error;
    await redirect(auth, provider);
  } finally {
    clearTimeout(timer);
  }
}
