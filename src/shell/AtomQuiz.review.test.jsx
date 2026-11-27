// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
vi.mock('./hooks/useFocusHudSignal.js', () => ({ useFocusHudSignal: () => {} }));
vi.mock('../ui/QuestionExplanation.jsx', () => ({ QuestionExplanation: ({ text }) => <div>{text}</div>, ChoiceNote: () => null, choiceNotes: () => ({ notes: {}, lead: '' }) }));
import { AtomQuiz } from './AtomQuiz.jsx';
import { recordForQuestion } from './AtomQuizReview.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text));

it('looks back at answered questions with your pick and the key, then returns to the live question unchanged', () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const questions = [1, 2, 3].map(n => ({ stem: `Clinical question ${n}`, choices: { A: `Alpha ${n}`, B: `Beta ${n}` }, correct: 'A', explanation: `Why ${n}.` }));
  const records = [
    { questionIndex: 0, picked: 'B', correct: false, confidence: 5 },
    { questionIndex: 1, picked: 'A', correct: true, confidence: 2 },
  ];
  act(() => root.render(<AtomQuiz questions={questions} initialState={{ i: 2, picked: 'B', confidence: null, records }} />));
  expect(host.textContent).toContain('Clinical question 3');
  act(() => button(host, '← Prev').click());
  expect(host.textContent).toContain('Reviewing question 2 of 3');
  expect(host.textContent).toContain('✓ Correct · confidence 2/5');
  act(() => button(host, '← Prev').click());
  expect(host.textContent).toContain('Clinical question 1');
  expect(host.textContent).toContain('✕ Your answer');
  expect(host.textContent).toContain('✓ Correct answer');
  expect(host.textContent).toContain('confidence 5/5');
  expect(host.textContent).toContain('Why 1.');
  expect(button(host, '← Prev').disabled).toBe(true);
  act(() => button(host, 'Next →').click());
  act(() => button(host, 'Next →').click());
  expect(host.textContent).toContain('Clinical question 3');
  expect(host.textContent).not.toContain('Reviewing question');
  act(() => root.unmount());
});

it('matches records by saved index, falling back to answer order for older sessions', () => {
  expect(recordForQuestion([{ questionIndex: 1, picked: 'C' }], 1)).toEqual({ questionIndex: 1, picked: 'C' });
  expect(recordForQuestion([{ picked: 'A' }, { picked: 'B' }], 1)).toEqual({ picked: 'B' });
  expect(recordForQuestion([{ questionIndex: 0 }], 1)).toBeNull();
});
