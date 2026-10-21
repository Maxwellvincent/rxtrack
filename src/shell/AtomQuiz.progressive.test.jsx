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
  const props = { questions, expectedCount: 15, preparing: false, onPrepareMore, onDone, preparationError: "Writer could not support the remaining targets.",
    initialState: { i: 2, picked: 'A', confidence: 3, records: [{ correct: true, confidence: 3 }] } };
  act(() => root.render(<AtomQuiz {...props} />));
  expect(host.querySelector('.quiz-count').textContent).toBe('3/3');
  expect(host.querySelector('[role="progressbar"]').getAttribute('aria-valuemax')).toBe('3');
  expect(host.textContent).toContain('12 of your requested questions still need preparation');
  expect(host.textContent).toContain('Preparation stopped: Writer could not support the remaining targets.');
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

it('continues from question 13 to the appended 14th and 15th without resetting the revealed answer',()=>{
 const host=document.createElement('div');const root=createRoot(host);
 const questions=Array.from({length:13},(_,i)=>({stem:`Reviewed question ${i+1}`,choices:{A:'One',B:'Two'},correct:'A',explanation:'Because.'}));
 const props={questions,expectedCount:15,onDone:vi.fn(),initialState:{i:12,picked:'A',confidence:3,records:[]}};
 act(()=>root.render(<AtomQuiz {...props}/>));
 expect(host.textContent).toContain('Reviewed question 13');
 const school=[14,15].map(i=>({...questions[0],stem:`Authentic school question ${i}`,sourceType:'question-bank',sourceFile:'Homework.pdf'}));
 act(()=>root.render(<AtomQuiz {...props} questions={[...questions,...school]}/>));
 expect(host.querySelector('.quiz-count').textContent).toBe('13/15');
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Next →').click());
 expect(host.textContent).toContain('Authentic school question 14');
 expect(host.textContent).toContain('Original school question · Homework.pdf');
 expect(props.onDone).not.toHaveBeenCalled();
 act(()=>root.unmount());
});
it('keeps a resumed quiz under one evidence session while counting fresh answered questions', async()=>{
 const storage = new Map();
 Object.defineProperty(globalThis,'localStorage',{value:{getItem:key=>storage.get(key) ?? null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},configurable:true});
 const {read}=await import('../stores/learnerEvidence.js');
 const host=document.createElement('div');document.body.append(host);
 const make=(id)=>({id,stem:`Which supplied relationship is tested by ${id}?`,choices:{A:'Source answer',B:'Other answer'},correct:'A',explanation:'Source explanation.',objectiveIds:['resume-objective'],generationMode:'grounded-fallback'});
 for(const id of ['resume-first','resume-second']){
  const root=createRoot(host);
  act(()=>root.render(<AtomQuiz questions={[make(id)]} sessionKey="saved-quiz-identity" lectureId="resume-lecture" blockId="NB" userId={null}/>));
  act(()=>host.querySelector('.quiz-choice').click());
  act(()=>[...host.querySelectorAll('button')].find(button=>button.textContent.includes('Confident')).click());
  act(()=>root.unmount());
 }
 expect(read(null).objectives['resume-objective']).toMatchObject({attempts:2,sessions:['saved-quiz-identity']});
 host.remove();
});
