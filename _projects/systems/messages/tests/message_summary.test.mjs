// "Catch me up": the button and panel that show an AI summary of the open direct message,
// with a stub API standing in for Spring.
import assert from 'node:assert/strict';
import test from 'node:test';

import { fakeEvent, installFakeDom, settle } from './fake-dom.mjs';

const { document } = installFakeDom();

const { initMessageSummary } = await import('../js/message-summary.js');

function makeSummary({ summarizeDm }) {
  const make = tag => document.createElement(tag);
  const elements = {
    button: make('button'), panel: make('div'), status: make('p'), body: make('div'), note: make('p'), close: make('button'),
  };
  elements.button.hidden = true;
  elements.panel.hidden = true;
  const asked = [];
  const added = [];
  const summary = initMessageSummary({
    api: { summarizeDm: id => { asked.push(id); return summarizeDm(id); } },
    elements,
    onAddToCalendar: (item, opener) => added.push([item, opener]),
  });
  const click = () => elements.button.dispatchEvent(fakeEvent('click'));
  return { elements, summary, asked, added, click };
}

const answer = {
  summary: ['The demo is Friday.', 'Ada brings the laptop.'],
  dates: [{ what: 'Demo', date: '2026-11-20', time: '15:00' }, { what: 'Nonsense', date: '2026-02-30', time: '' }],
  todos: ['Bring the laptop.'],
  messagesRead: 12,
};

test('the button shows only while a direct message is open', () => {
  const { elements, summary } = makeSummary({ summarizeDm: async () => answer });
  summary.setConversation(5);
  assert.equal(elements.button.hidden, false);
  summary.setConversation(null);
  assert.equal(elements.button.hidden, true);
});

test('asking shows the summary, the dates with an Add to calendar button, and the to-dos', async () => {
  const { elements, summary, asked, added, click } = makeSummary({ summarizeDm: async () => answer });
  summary.setConversation(5);

  click();
  assert.equal(elements.status.textContent, 'Reading the recent messages…');
  assert.equal(elements.button.disabled, true);
  await settle();

  assert.deepEqual(asked, [5]);
  assert.equal(elements.panel.hidden, false);
  assert.equal(elements.button.disabled, false);
  assert.equal(elements.status.textContent, 'Read the last 12 messages.');
  const text = elements.body.textContent;
  assert.match(text, /The demo is Friday\./);
  assert.match(text, /Demo — Fri, Nov 20 at 3:00 PM/);
  assert.match(text, /Bring the laptop\./);
  assert.doesNotMatch(text, /Nonsense/, 'a date that is not a real day is left out');

  const add = elements.body.querySelectorAll('button');
  assert.equal(add.length, 1);
  add[0].dispatchEvent(fakeEvent('click'));
  assert.deepEqual(added[0][0], { what: 'Demo', date: '2026-11-20', time: '15:00' });
  assert.equal(added[0][1], add[0]);
  assert.equal(elements.note.hidden, false);
});

test('what the AI says is drawn as text, never as markup', async () => {
  const { elements, summary, click } = makeSummary({
    summarizeDm: async () => ({ summary: ['<img src=x onerror=alert(1)>'], dates: [], todos: [] }),
  });
  summary.setConversation(5);
  click();
  await settle();
  assert.equal(elements.body.querySelector('img'), null);
  assert.match(elements.body.textContent, /<img src=x onerror=alert\(1\)>/);
});

test('each kind of failure says what to do', async t => {
  t.mock.method(console, 'warn', () => {});
  const cases = [[400, /enough messages/], [429, /Try again later/], [401, /signed out/], [403, /signed out/], [503, /Try again in a minute/]];
  for (const [status, words] of cases) {
    const { elements, summary, click } = makeSummary({ summarizeDm: async () => { throw Object.assign(new Error('x'), { status }); } });
    summary.setConversation(5);
    click();
    await settle();
    assert.match(elements.status.textContent, words, `HTTP ${status}`);
    assert.equal(elements.button.disabled, false, 'it can be asked again');
    assert.equal(elements.body.querySelectorAll('li').length, 0);
  }
});

test('an answer with nothing in it says so', async () => {
  const { elements, summary, click } = makeSummary({ summarizeDm: async () => ({ summary: [], dates: [], todos: [] }) });
  summary.setConversation(5);
  click();
  await settle();
  assert.match(elements.status.textContent, /nothing to add/);
  assert.equal(elements.note.hidden, true);
});

test('pressing it again while it is still reading asks nothing more', async () => {
  let release;
  const { summary, asked, click } = makeSummary({ summarizeDm: () => new Promise(resolve => { release = () => resolve(answer); }) });
  summary.setConversation(5);
  click();
  click();
  assert.equal(asked.length, 1);
  release();
  await settle();
});

test('an answer that arrives after switching chats or closing the panel is dropped', async () => {
  let release;
  const { elements, summary, click } = makeSummary({ summarizeDm: () => new Promise(resolve => { release = () => resolve(answer); }) });
  summary.setConversation(5);
  click();
  summary.setConversation(6);
  release();
  await settle();
  assert.equal(elements.panel.hidden, true);
  assert.equal(elements.body.textContent, '');

  click();
  elements.close.dispatchEvent(fakeEvent('click'));
  release();
  await settle();
  assert.equal(elements.panel.hidden, true);
  assert.equal(elements.body.textContent, '');
});

test('switching chats clears the last summary', async () => {
  const { elements, summary, click } = makeSummary({ summarizeDm: async () => answer });
  summary.setConversation(5);
  click();
  await settle();
  assert.notEqual(elements.body.textContent, '');
  summary.setConversation(6);
  assert.equal(elements.body.textContent, '');
  assert.equal(elements.panel.hidden, true);
});
