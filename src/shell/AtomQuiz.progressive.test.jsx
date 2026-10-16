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
  const onDone = vi.fn();
  const props = { questions: [question], expectedCount: 3, preparing: true, onDone, initialState: { i: 0, picked: 'A', confidence: 3, records: [] } };
  act(() => root.render(<AtomQuiz {...props} />));
  expect(host.textContent).toContain('/3');
  act(() => host.querySelector('.quiz-surface').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(onDone).not.toHaveBeenCalled();
  expect([...host.querySelectorAll('button')].find(button => button.textContent.includes('Preparing next question')).disabled).toBe(true);
  act(() => root.render(<AtomQuiz {...props} questions={[question, { ...question, stem: 'Second clinical question' }]} />));
  expect(host.textContent).toContain('First clinical question');
  const next = [...host.querySelectorAll('button')].find(button => button.textContent === 'Next →');
  expect(next.disabled).toBe(false);
  act(() => next.click());
  expect(host.textContent).toContain('Second clinical question');
  act(() => root.unmount());
});

it('shows the available total after preparation stops and offers continuation without finishing', () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const questions = [1, 2, 3].map(n => ({ stem: `Clinical question ${n}`, choices: { A: 'One', B: 'Two' }, correct: 'A', explanation: 'Because one.' }));
  const onPrepareMore = vi.fn(), onDone = vi.fn();
  const props = { questions, expectedCount: 15, preparing: false, onPrepareMore, onDone,
    initialState: { i: 2, picked: 'A', confidence: 3, records: [{ correct: true, confidence: 3 }] } };
  act(() => root.render(<AtomQuiz {...props} />));
  expect(host.querySelector('.quiz-count').textContent).toBe('3/3');
  expect(host.querySelector('[role="progressbar"]').getAttribute('aria-valuemax')).toBe('3');
  expect(host.textContent).toContain('12 of your requested questions still need preparation');
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Prepare remaining 12 questions').click());
  expect(onPrepareMore).toHaveBeenCalledOnce();
  expect(onDone).not.toHaveBeenCalled();
  act(() => root.render(<AtomQuiz {...props} preparing />));
  expect([...host.querySelectorAll('button')].find(b => b.textContent === 'Preparing next question…').disabled).toBe(true);
  act(() => root.render(<AtomQuiz {...props} questions={[...questions, { ...questions[0], stem: 'New fourth question' }]} />));
  expect(host.textContent).toContain('Clinical question 3');
  expect(host.querySelector('.quiz-count').textContent).toBe('3/4');
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Next →').click());
  expect(host.textContent).toContain('New fourth question');
  expect(onDone).not.toHaveBeenCalled();
  act(() => root.unmount());
});
