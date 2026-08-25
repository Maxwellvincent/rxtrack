// functions/struggleTaskBridge.js
//
// Mirrors struggleTasks CONTENT (never doneLocally/doneAt — completion status
// flows the other way, from focus-hud/functions/index.js) from this project
// (rxtrack-med, the source of truth for what Anki exported) into focus-hud-lvm,
// so the focus-hud UI can show the same tasks without its own sync pipeline.
//
// Cross-project write needs the function's runtime service account granted
// roles/datastore.user on focus-hud-lvm (see docs/struggle-task-bridge.md).
// No key file: Cloud Functions v2 resolves ADC to that runtime SA automatically.
//
// Loop safety: this function only ever writes CONTENT_FIELDS, and skips the
// write entirely when the destination's content fields already match — so a
// round trip through focus-hud's reverse bridge (which only touches
// doneLocally/doneAt) never triggers a second content write here.

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

const FOCUS_HUD_PROJECT_ID = "focus-hud-lvm";
const BRIDGE_SERVICE_ACCOUNT = "struggle-bridge@rxtrack-med.iam.gserviceaccount.com";

// rxtrack-med and focus-hud-lvm are separate Firebase projects: the same
// Google account gets a DIFFERENT uid in each project (confirmed via
// VITE_OWNER_UID in focus-hud/.env.local vs rxtrack-med's dev uid). A write
// under the rxtrack uid landed at a path focus-hud's own login/rules never
// look at — this map is the fix. Single-user app, so a literal map is fine.
const UID_MAP = {
  KX9K9IK4DgU0dBoAD6pj6Q4CEgr1: "IDTw5uOiTTRHuAuJMTLEG0u3Nfl2",
};

const CONTENT_FIELDS = [
  "cardId", "state", "remediation", "concept", "subject", "lecture",
  "reason", "front", "deck", "tags", "buriedAt",
  "releasedLocally", "releasedAt",
];

let focusHudApp = null;
function focusHudDb() {
  if (!focusHudApp) {
    focusHudApp = admin.apps.find((a) => a?.name === "focusHudBridge")
      || admin.initializeApp({ projectId: FOCUS_HUD_PROJECT_ID }, "focusHudBridge");
  }
  return admin.firestore(focusHudApp);
}

function pickContent(data) {
  const out = {};
  for (const k of CONTENT_FIELDS) out[k] = data?.[k] ?? null;
  return out;
}

function sameContent(a, b) {
  return CONTENT_FIELDS.every((k) => JSON.stringify(a?.[k] ?? null) === JSON.stringify(b?.[k] ?? null));
}

async function handleWrite(event) {
  const uid = event.params.uid;
  const focusHudUid = UID_MAP[uid];
  if (!focusHudUid) return; // no known focus-hud account for this rxtrack uid — nothing to mirror
  const cardId = event.params.cardId;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  const destRef = focusHudDb().collection("users").doc(focusHudUid).collection("struggleTasks").doc(cardId);

  if (!after) {
    // Source card resolved/removed in Anki — drop the mirrored copy too.
    await destRef.delete().catch(() => {});
    return;
  }

  const nextContent = pickContent(after);
  const destSnap = await destRef.get();
  if (destSnap.exists && sameContent(destSnap.data(), nextContent)) return; // no-op guard: breaks the round-trip loop

  await destRef.set(
    { ...nextContent, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

exports.bridgeStruggleTaskToFocusHud = onDocumentWritten(
  { document: "users/{uid}/struggleTasks/{cardId}", serviceAccount: BRIDGE_SERVICE_ACCOUNT },
  handleWrite
);

exports.__test = { pickContent, sameContent, CONTENT_FIELDS };
