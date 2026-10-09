// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import { DailyPlanSettingsModal } from './DailyPlanSettingsModal.jsx';
import { readPreference } from '../../../browserStorage.js';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it('applies settings without crashing when storage is full and explains session-only persistence', () => {
  const host=document.createElement('div'); const root=createRoot(host); const close=vi.fn();
  const fail=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('full','QuotaExceededError')});
  act(()=>root.render(<DailyPlanSettingsModal blockId="quota-test" onClose={close}/>));
  act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save').click());
  expect(host.textContent).toContain('Settings apply for this session');
  expect(close).not.toHaveBeenCalled();
  expect(JSON.parse(readPreference('rxt-lecconfig-quota-test')).gymTime).toBe('21:00');
  act(()=>root.unmount());fail.mockRestore();
});
