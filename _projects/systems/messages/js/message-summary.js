// "Catch me up": a button in the header of a direct message that asks Spring's AI for a
// short summary of the chat, the dates it mentions and any to-dos, and shows them in a
// panel under the header. A date can be added to your calendar from there.
//
// The page tells this module which chat is open through setConversation(id); with no
// direct message open (nothing, or a group) the button is hidden and the panel closed.
// Everything the AI says is drawn as text, never as markup.
import { fillText } from './message-log.js';
import { clockLabel, dateLabel } from './schedule-model.js';

export const SUMMARY_TEXTS = Object.freeze({
  reading: 'Reading the recent messages…',
  read: 'Read the last {count} messages.',
  nothing: 'The AI had nothing to add about this chat.',
  tooShort: 'There aren’t enough messages in this chat to summarize yet.',
  limit: 'That’s a lot of summaries this hour. Try again later.',
  signedOut: 'You are signed out. Sign in again, then try again.',
  failed: 'The AI couldn’t make a summary right now. Try again in a minute.',
  happened: 'What happened',
  dates: 'Dates',
  todos: 'To do',
  addToCalendar: 'Add to calendar',
});

const list = value => (Array.isArray(value) ? value : []);

export function initMessageSummary({ api, elements, onAddToCalendar = () => {}, texts = SUMMARY_TEXTS }) {
  const { button, panel, status, body, note, close } = elements;
  let conversationId = null;
  let ticket = 0; // a newer ask, or a closed panel, makes an answer still loading stop
  let loading = false;

  function reset() {
    ticket += 1;
    loading = false;
    panel.hidden = true;
    status.textContent = '';
    body.replaceChildren();
    note.hidden = true;
    button.disabled = false;
  }

  function setConversation(id) {
    if (id === conversationId) return;
    conversationId = id;
    reset();
    button.hidden = id === null;
  }

  function heading(label) {
    const element = document.createElement('p');
    element.className = 'dm__summary-label';
    element.textContent = label;
    return element;
  }

  function bullets(items) {
    const element = document.createElement('ul');
    element.className = 'dm__summary-list';
    items.forEach(item => {
      const row = document.createElement('li');
      row.textContent = item;
      element.appendChild(row);
    });
    return element;
  }

  function dateRows(items) {
    const element = document.createElement('ul');
    element.className = 'dm__summary-list';
    items.forEach(item => {
      const row = document.createElement('li');
      row.className = 'dm__summary-date';
      const when = [dateLabel(item.date), clockLabel(item.time)].filter(Boolean).join(' at ');
      const label = document.createElement('span');
      label.textContent = `${item.what} — ${when}`;
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'dm__action';
      add.textContent = texts.addToCalendar;
      add.addEventListener('click', () => onAddToCalendar(item, add));
      row.append(label, add);
      element.appendChild(row);
    });
    return element;
  }

  function render(result) {
    const summary = list(result?.summary).map(String).filter(Boolean);
    const todos = list(result?.todos).map(String).filter(Boolean);
    // A date the page can't name (no real day) is left out rather than shown as "".
    const dates = list(result?.dates)
      .map(item => ({ what: String(item?.what ?? ''), date: String(item?.date ?? ''), time: String(item?.time ?? '') }))
      .filter(item => item.what && dateLabel(item.date));
    body.replaceChildren();
    if (!summary.length && !dates.length && !todos.length) {
      status.textContent = texts.nothing;
      return;
    }
    if (summary.length) body.append(heading(texts.happened), bullets(summary));
    if (dates.length) body.append(heading(texts.dates), dateRows(dates));
    if (todos.length) body.append(heading(texts.todos), bullets(todos));
    status.textContent = typeof result?.messagesRead === 'number' ? fillText(texts.read, { count: result.messagesRead }) : '';
    note.hidden = false;
  }

  function failure(error) {
    switch (error?.status) {
      case 400: return texts.tooShort;
      case 429: return texts.limit;
      case 401:
      case 403: return texts.signedOut;
      default: return texts.failed;
    }
  }

  button.addEventListener('click', async () => {
    if (conversationId === null || loading) return;
    const id = conversationId;
    reset();
    const mine = ticket;
    loading = true;
    button.disabled = true;
    panel.hidden = false;
    status.textContent = texts.reading;
    let result;
    try {
      result = await api.summarizeDm(id);
    } catch (error) {
      if (mine !== ticket) return;
      console.warn('Messages: could not summarize the chat', error);
      loading = false;
      button.disabled = false;
      status.textContent = failure(error);
      return;
    }
    if (mine !== ticket) return;
    loading = false;
    button.disabled = false;
    render(result);
  });

  close.addEventListener('click', () => {
    reset();
    button.focus();
  });

  return { setConversation };
}
