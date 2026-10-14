// UI access to the signed-in user's session-only diagnostics. This grants no
// backend privileges and never exposes another account's records.
const ownerIds = String(import.meta.env.VITE_RXTRACK_ADMIN_UIDS || "KX9K9IK4DgU0dBoAD6pj6Q4CEgr1").split(",").map(id => id.trim()).filter(Boolean);
export const canViewQuestionDiagnostics = userId => !!userId && ownerIds.includes(userId);
