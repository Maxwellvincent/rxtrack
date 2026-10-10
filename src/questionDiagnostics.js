// Session-only, bounded metadata. Never retain stems, source text, prompts or model responses.
const key = 'rxt-question-diagnostics-v1';
export function sanitizeQuestionDiagnostics(report = {}) {
  const number = value => Math.max(0, Number(value) || 0);
  const providers = new Set(['codex', 'ollama-cloud', 'unreported']);
  return { version: 1, requested: number(report.requested), accepted: number(report.accepted), elapsedMs: number(report.elapsedMs),
    source: { objectives: number(report.source?.objectives), schoolExamples: number(report.source?.schoolExamples) },
    calls: (report.calls || []).slice(-60).map(call => ({
      stage: ['draft','review','repair'].includes(call.stage) ? call.stage : 'draft',
      status: ['running','complete','cancelled','timeout','failed'].includes(call.status) ? call.status : 'failed',
      provider: providers.has(call.provider) ? call.provider : 'unreported',
      startedMs: number(call.startedMs), durationMs: number(call.durationMs),
    })),
    rejections: Object.fromEntries(Object.entries(report.rejections || {}).filter(([issue]) => /^[a-z_]{1,60}$/.test(issue)).slice(0, 30).map(([issue,count]) => [issue,number(count)])),
  };
}
export function readQuestionDiagnostics(userId, lectureId) {
  try { return JSON.parse(sessionStorage.getItem(key) || '{}')[`${userId}:${lectureId}`] || null; } catch { return null; }
}
export function saveQuestionDiagnostics(userId, lectureId, report) {
  try {
    const records = JSON.parse(sessionStorage.getItem(key) || '{}');
    const id = `${userId}:${lectureId}`;
    delete records[id]; records[id] = sanitizeQuestionDiagnostics(report);
    sessionStorage.setItem(key, JSON.stringify(Object.fromEntries(Object.entries(records).slice(-10))));
  } catch { /* diagnostics must never block preparation */ }
}
