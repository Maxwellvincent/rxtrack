const REDIRECT_FALLBACK_CODES = new Set([
  "auth/popup-blocked",
  "auth/web-storage-unavailable",
  "auth/operation-not-supported-in-this-environment",
]);

/** Start Google auth without allowing an invisible popup attempt to hang forever. */
export async function startGoogleSignIn({
  auth,
  provider,
  popup,
  redirect,
  preferRedirect = false,
}) {
  // A full-page redirect avoids popup cleanup races caused by COOP. In
  // particular, Firebase may have authenticated successfully while its popup
  // promise is still waiting to close; racing that promise with our timeout
  // used to start a second auth attempt and strand the shell signed out.
  if (preferRedirect) {
    await redirect(auth, provider);
    return;
  }

  try {
    return await popup(auth, provider);
  } catch (error) {
    if (!REDIRECT_FALLBACK_CODES.has(error?.code)) throw error;
    return redirect(auth, provider);
  }
}
