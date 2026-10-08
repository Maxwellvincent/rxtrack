// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
vi.mock('./hooks/useFocusHudSignal.js', () => ({ useFocusHudSignal: () => {} }));
vi.mock('../ui/QuestionExplanation.jsx', () => ({ QuestionExplanation: () => <div>Explanation</div> }));
import { AtomQuiz } from './AtomQuiz.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it('appends reviewed questions without losing revealed answer state and waits at the frontier', () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const question = { stem: 'First clinical question', choices: { A: 'One', B: 'Two' }, correct: 'A', explanation: 'Because one.' };
  const props = { questions: [question], expectedCount: 3, preparing: true, initialState: { i: 0, picked: 'A', confidence: 3, records: [] } };
  act(() => root.render(<AtomQuiz {...props} />));
  expect(host.textContent).toContain('/3');
  expect([...host.querySelectorAll('button')].find(button => button.textContent.includes('Preparing next question')).disabled).toBe(true);
  act(() => root.render(<AtomQuiz {...props} questions={[question, { ...question, stem: 'Second clinical question' }]} />));
  expect(host.textContent).toContain('First clinical question');
  const next = [...host.querySelectorAll('button')].find(button => button.textContent === 'Next →');
  expect(next.disabled).toBe(false);
  act(() => next.click());
  expect(host.textContent).toContain('Second clinical question');
  act(() => root.unmount());
});
