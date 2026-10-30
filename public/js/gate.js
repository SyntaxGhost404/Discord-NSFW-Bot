import { h } from './dom.js';
import { TEXT } from './text.js';
import { mark } from './mark.js';

const KEY = 'cosplay-viewer:adult';

function remembered() {
  try {
    return localStorage.getItem(KEY) === 'yes';
  } catch {
    return false;
  }
}

function remember() {
  try {
    localStorage.setItem(KEY, 'yes');
  } catch {
    // Storage is blocked (for example, in a private window): ask again next time.
  }
}

// Whether this browser will keep the answer, so the gate never promises
// what it cannot do.
function canRemember() {
  try {
    localStorage.setItem(`${KEY}:check`, '1');
    localStorage.removeItem(`${KEY}:check`);
    return true;
  } catch {
    return false;
  }
}

// The app shows and fetches nothing until the visitor confirms their age.
// The answer is kept on the device, so returning visitors go straight in.
export function ageGate(root, enter) {
  if (remembered()) {
    enter();
    return;
  }
  const confirm = h('button', { class: 'btn btn-primary sq', type: 'button' }, TEXT.gateEnter);
  const leave = h('button', { class: 'btn btn-secondary sq', type: 'button' }, TEXT.gateLeave);
  const gate = h('div', { class: 'gate', role: 'dialog', tabindex: '-1', 'aria-modal': 'true', 'aria-labelledby': 'gate-title', 'aria-describedby': 'gate-body' },
    h('div', { class: 'gate-panel' },
      mark(64),
      h('h1', { id: 'gate-title', class: 'gate-title' }, TEXT.gateTitle),
      h('p', { id: 'gate-body', class: 'gate-body' }, TEXT.gateBody),
      h('div', { class: 'gate-actions' }, confirm, leave),
      h('p', { class: 'gate-note' }, canRemember() ? TEXT.gateNote : TEXT.gateUnsaved)));
  confirm.addEventListener('click', () => {
    remember();
    gate.remove();
    enter();
  });
  leave.addEventListener('click', () => location.replace('about:blank'));
  root.append(gate);
  // Focus the dialog itself so it is announced; the first Tab reaches the buttons.
  gate.focus();
}
