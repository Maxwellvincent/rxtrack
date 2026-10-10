export function QuestionPreparationDetails({ report }) {
  if (!report) return null;
  const providers = [...new Set((report.calls || []).map(call => call.provider).filter(provider => provider !== 'unreported'))];
  return <details className="my-3 rounded-lg border border-border px-3 py-2 text-xs text-text-2">
    <summary className="cursor-pointer">Question preparation details · {report.accepted}/{report.requested} accepted</summary>
    <p className="mt-2">Elapsed: {Math.round((report.elapsedMs || 0) / 1000)} seconds · Providers: {providers.join(', ') || 'not reported'}</p>
    <ul className="mt-2">{['draft', 'review', 'repair'].map(stage => {
      const calls = (report.calls || []).filter(call => call.stage === stage);
      const stopped = calls.filter(call => ['timeout', 'failed', 'cancelled'].includes(call.status)).length;
      return <li key={stage}>{stage}: {calls.length} calls · {Math.round(calls.reduce((sum, call) => sum + (call.durationMs || 0), 0) / 1000)} seconds of call time{stopped > 0 ? ` · ${stopped} stopped or failed` : ''}</li>;
    })}</ul>
    <p className="mt-2">Call times can overlap. Elapsed time is the total wait.</p>
    {Object.keys(report.rejections || {}).length > 0 && <ul className="mt-2">{Object.entries(report.rejections).map(([issue, count]) => <li key={issue}>{issue.replaceAll('_', ' ')}: {count}</li>)}</ul>}
    <p className="mt-2">Source set: {report.source?.objectives || 0} objectives · {report.source?.schoolExamples || 0} school examples. Diagnostics contain counts and timings only.</p>
  </details>;
}
