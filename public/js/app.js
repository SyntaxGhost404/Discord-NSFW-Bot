import { lookupUser } from './api.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { renderNotice, renderProfile, renderSkeleton } from './profile.js';
import { readId } from './snowflake.js';
import { startSquircles } from './squircle.js';
import { TEXT } from './text.js';

// A lookup has its own address, /<user id>, so it can be shared, and the
// back button returns to the one before.

startSquircles(document.body);

const input = h('input', {
  id: 'user-id',
  class: 'search-input',
  type: 'text',
  name: 'id',
  inputmode: 'numeric',
  autocomplete: 'off',
  autocapitalize: 'none',
  spellcheck: 'false',
  enterkeyhint: 'search',
  maxlength: '64',
  placeholder: TEXT.idPlaceholder,
});
const clearButton = h('button', { class: 'search-clear', type: 'button', 'aria-label': TEXT.clear, hidden: true }, icon('close', 18));
const form = h('form', { class: 'search', role: 'search' },
  h('label', { class: 'visually-hidden', for: 'user-id' }, TEXT.idLabel),
  h('div', { class: 'search-field sq' }, input, clearButton),
  // On narrow screens only the icon shows, so a whole ID fits in the field.
  h('button', { class: 'btn btn-primary search-go sq', type: 'submit', 'aria-label': TEXT.lookUp }, icon('search', 20), h('span', { class: 'btn-label' }, TEXT.lookUp)));
const status = h('p', { class: 'visually-hidden', role: 'status' });
const result = h('div', { class: 'result' });

document.getElementById('app').replaceChildren(
  h('header', { class: 'top' },
    h('span', { class: 'mark sq' }, icon('mark', 20)),
    h('h1', { class: 'title' }, TEXT.app)),
  h('p', { class: 'intro' }, TEXT.intro),
  form,
  status,
  result,
  h('footer', { class: 'footer' }, TEXT.footer));

let current = 0;

function idFromAddress() {
  try {
    return decodeURIComponent(location.pathname.slice(1));
  } catch {
    return location.pathname.slice(1);
  }
}

async function show(text, { push = false } = {}) {
  const run = ++current;
  const checked = readId(text);
  if (checked.error) {
    result.replaceChildren(renderNotice(checked.error));
    status.textContent = '';
    return;
  }
  const { id } = checked;
  input.value = id;
  clearButton.hidden = false;
  const address = `/${id}`;
  if (push && location.pathname !== address) history.pushState(null, '', address);
  else if (location.pathname !== address) history.replaceState(null, '', address);
  result.replaceChildren(renderSkeleton());
  try {
    const data = await lookupUser(id);
    if (run !== current) return;
    const name = data.user.global_name || data.user.username;
    result.replaceChildren(renderProfile(data));
    status.textContent = TEXT.found(name);
    document.title = `${name} · ${TEXT.app}`;
  } catch (error) {
    if (run !== current) return;
    result.replaceChildren(renderNotice(error.reason ?? error.code, { retryAfter: error.retryAfter, onRetry: () => show(id) }));
    status.textContent = '';
    document.title = TEXT.app;
  }
}

function reset() {
  current += 1;
  input.value = '';
  clearButton.hidden = true;
  result.replaceChildren();
  status.textContent = '';
  document.title = TEXT.app;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  input.blur();
  show(input.value, { push: true });
});

input.addEventListener('input', () => {
  clearButton.hidden = input.value === '';
});

clearButton.addEventListener('click', () => {
  reset();
  if (location.pathname !== '/') history.pushState(null, '', '/');
  input.focus();
});

addEventListener('popstate', () => {
  const text = idFromAddress();
  if (text) show(text);
  else reset();
});

const initial = idFromAddress();
if (initial) show(initial);
else input.focus({ preventScroll: true });
