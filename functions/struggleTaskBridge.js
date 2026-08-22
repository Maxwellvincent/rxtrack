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

const CONTENT_FIELDS = [
  "cardId", "state", "remediation", "concept", "subject", "lecture",
  "reason", "front", "deck", "tags", "buriedAt",
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
  const cardId = event.params.cardId;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  const destRef = focusHudDb().collection("users").doc(uid).collection("struggleTasks").doc(cardId);

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
