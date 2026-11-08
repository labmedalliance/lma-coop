// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Small menu above selected text: copy, cut, comment, delete.
// Cut and delete run as normal editor transactions, so in suggestion mode they become suggestions.
import { TextSelection } from '@tiptap/pm/state';
import { toast } from './base.js';
import { t } from './i18n.js';

const GAP = 8;
const touch = window.matchMedia('(pointer: coarse)');

/** Sets up the menu. `onComment()` starts a comment on the current selection. */
export function setupSelectionMenu({ editor, onComment }) {
  const menu = document.createElement('div');
  menu.className = 'selection-menu d-print-none';
  menu.setAttribute('role', 'toolbar');
  menu.setAttribute('aria-label', t('Auswahl'));
  menu.hidden = true;

  const actions = [
    ['copy', 'copy', t('Kopieren'), copy],
    ['cut', 'cut', t('Ausschneiden'), cut],
    ['comment', 'message-plus', t('Kommentieren'), () => { hide(); onComment(); }],
    ['delete', 'trash', t('Löschen'), remove],
  ];
  for (const [name, icon, label, run] of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.action = name;
    btn.title = label;
    btn.innerHTML = `<i class="ti ti-${icon}"></i>`;
    const text = document.createElement('span');
    text.textContent = label;
    btn.append(text);
    btn.addEventListener('click', run);
    menu.append(btn);
  }
  // Keeps focus and selection in the editor while a button is pressed.
  menu.addEventListener('mousedown', (e) => e.preventDefault());
  document.body.append(menu);

  const selectedText = () => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, '\n', ' ').replace(/​/g, '');
  };

  // The browser's own copy/cut keeps formatting and lets the editor handle cutting (incl. suggestion mode).
  // Without permission for it, fall back to plain text via the Clipboard API.
  async function copy() {
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    if (!ok) {
      try { await navigator.clipboard.writeText(selectedText()); ok = true; } catch { ok = false; }
    }
    toast(t(ok ? 'Kopiert' : 'Kopieren nicht möglich. Nutze Strg+C.'), { timeout: 2000 });
    hide();
  }

  async function cut() {
    let ok = false;
    try { ok = document.execCommand('cut'); } catch { ok = false; }
    if (!ok) {
      try {
        await navigator.clipboard.writeText(selectedText());
        editor.chain().focus().deleteSelection().run();
        ok = true;
      } catch { ok = false; }
    }
    if (!ok) toast(t('Ausschneiden nicht möglich. Nutze Strg+X.'));
    hide();
  }

  function remove() {
    editor.chain().focus().deleteSelection().run();
    hide();
  }

  function hide() {
    menu.hidden = true;
  }

  let pointerDown = false;

  function update() {
    const { selection } = editor.state;
    if (pointerDown || !editor.isFocused || !(selection instanceof TextSelection) || selection.empty || !selectedText().trim()) {
      hide();
      return;
    }
    const { view } = editor;
    const start = view.coordsAtPos(selection.from);
    const end = view.coordsAtPos(selection.to);
    const area = document.querySelector('.sheet-scroll').getBoundingClientRect();
    // Hide when the selection is scrolled out of view.
    if (end.bottom < area.top || start.top > area.bottom) {
      hide();
      return;
    }
    menu.hidden = false;
    const { width, height } = menu.getBoundingClientRect();
    const sameLine = Math.abs(start.top - end.top) < 4;
    const center = sameLine ? (start.left + end.right) / 2 : start.left + width / 2;
    let top = start.top - height - GAP;
    // On touch screens the system menu sits above the selection, so ours goes below.
    if (touch.matches || top < area.top) top = end.bottom + GAP;
    const left = Math.min(Math.max(center - width / 2, GAP), window.innerWidth - width - GAP);
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
  }

  // While the mouse selects text, the menu waits until the button is released.
  editor.view.dom.addEventListener('mousedown', () => { pointerDown = true; hide(); });
  document.addEventListener('mouseup', () => {
    if (!pointerDown) return;
    pointerDown = false;
    requestAnimationFrame(update);
  });
  editor.on('selectionUpdate', update);
  editor.on('focus', update);
  editor.on('blur', ({ event }) => {
    if (!menu.contains(event?.relatedTarget)) hide();
  });
  document.querySelector('.sheet-scroll').addEventListener('scroll', () => { if (!menu.hidden) update(); }, { passive: true });
  window.addEventListener('resize', () => { if (!menu.hidden) update(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) hide();
  });

  return { hide };
}
