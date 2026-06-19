export function createSession(size = 10) {
  return { size, index: 0, results: [], done: false };
}

export function advanceSession(state, item) {
  const results = [...state.results, item];
  const index = state.index + 1;
  return { ...state, results, index, done: index >= state.size };
}

export function sessionSummary(state) {
  const r = state.results || [];
  return {
    total: r.length,
    correct: r.filter((x) => x.outcome === "correct").length,
    wrong: r.filter((x) => x.outcome === "wrong").length,
    exposures: r.filter((x) => x.outcome === "exposure").length,
    masteredGained: r.filter((x) => x.outcome === "correct" && x.becameMastered).length,
  };
}
