/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* =====================================================================
   alert / confirm / prompt that actually work in the native shell
   ---------------------------------------------------------------------
   wry — the webview layer under Tauri — implements none of WKWebView's
   JavaScript dialog delegates. Inside the native macOS app that means
   window.confirm() returns false without showing anything, window.prompt()
   returns null the same way, and window.alert() does nothing at all.

   Nothing throws. Every destructive confirmation in the suite simply
   answered "no", so deletes and shredding quietly did nothing, and the
   chat lock could never be switched on because the PIN prompt came back
   null the instant it was called.

   These replacements are drawn in the page, so the browser build and the
   native build behave identically, they follow the app's theme and text
   direction, and — unlike window.prompt, which shows what you type — they
   can mask a PIN.

   They are asynchronous, because a modal drawn in the page cannot block
   the event loop the way the native ones did. Callers await them.
   ===================================================================== */
(function (global) {
  'use strict';

  const FALLBACK_TEXT = {
    fa: { ok: 'تأیید', cancel: 'انصراف', title: 'P00RIJA' },
    en: { ok: 'OK', cancel: 'Cancel', title: 'P00RIJA' },
  };

  function language() {
    const fromApp = global.PoorijaApp?.state?.language;
    if (fromApp === 'fa' || fromApp === 'en') return fromApp;
    return (document.documentElement.lang || 'fa').startsWith('en') ? 'en' : 'fa';
  }

  function text(key) {
    return FALLBACK_TEXT[language()][key];
  }

  /* One dialog at a time. Two overlapping modals would fight over focus and
     over the Escape key, and a caller that opened the second would never learn
     that the first was still waiting. */
  let chain = Promise.resolve();
  let root = null;
  /* Every dialog reuses the same elements, so a closing dialog's deferred
     cleanup must not touch an input that already belongs to the next one.
     The "enter it again" step of setting a chat PIN opens the second prompt
     well inside the first one's 160 ms fade-out, and without this counter the
     first one's cleanup wiped what had just been typed into the second. */
  let generation = 0;

  function build() {
    if (root) return root;
    root = document.createElement('div');
    root.className = 'poorija-dialog-backdrop hidden';
    root.setAttribute('role', 'presentation');
    root.innerHTML = `
      <div class="poorija-dialog" role="dialog" aria-modal="true" aria-labelledby="poorijaDialogTitle">
        <h2 id="poorijaDialogTitle" class="poorija-dialog-title"></h2>
        <p class="poorija-dialog-message"></p>
        <input id="poorijaDialogPassword" class="poorija-dialog-input hidden" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button type="button" class="poorija-dialog-reveal hidden"></button>
        <input id="poorijaDialogConfirmPassword" class="poorija-dialog-confirm-input hidden" type="password" autocomplete="new-password">
        <div class="poorija-dialog-choices hidden" role="radiogroup"></div>
        <p class="poorija-dialog-error hidden"></p>
        <div class="poorija-dialog-actions">
          <button type="button" class="poorija-dialog-btn poorija-dialog-cancel"></button>
          <button type="button" class="poorija-dialog-btn poorija-dialog-ok"></button>
        </div>
      </div>`;
    document.body.appendChild(root);
    return root;
  }

  function open(config) {
    const node = build();
    const dialog = node.querySelector('.poorija-dialog');
    const titleEl = node.querySelector('.poorija-dialog-title');
    const messageEl = node.querySelector('.poorija-dialog-message');
    const input = node.querySelector('.poorija-dialog-input');
    const confirmInput = node.querySelector('.poorija-dialog-confirm-input');
    const reveal = node.querySelector('.poorija-dialog > .poorija-dialog-reveal');
    const choicesEl = node.querySelector('.poorija-dialog-choices');
    const errorEl = node.querySelector('.poorija-dialog-error');
    const okBtn = node.querySelector('.poorija-dialog-ok');
    const cancelBtn = node.querySelector('.poorija-dialog-cancel');

    titleEl.textContent = config.title || text('title');
    /* textContent, never innerHTML: these messages interpolate key names,
       file names and peer names that came from other people. */
    messageEl.textContent = config.message == null ? '' : String(config.message);
    messageEl.classList.toggle('hidden', !messageEl.textContent);

    okBtn.textContent = config.okLabel || text('ok');
    cancelBtn.textContent = config.cancelLabel || text('cancel');
    cancelBtn.classList.toggle('hidden', config.kind === 'alert');
    okBtn.classList.toggle('is-danger', Boolean(config.danger));

    /* A question with a fixed set of answers. Rendered as buttons rather than a
       <select> so every option is visible at once - the point of asking is that
       the reader can see what they are choosing between. Labels go in with
       textContent: they can carry names that came from other people. */
    const wantsChoices = config.kind === 'choose' && Array.isArray(config.choices) && config.choices.length;
    choicesEl.classList.toggle('hidden', !wantsChoices);
    choicesEl.innerHTML = '';
    if (wantsChoices) {
      config.choices.forEach((choice, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'poorija-dialog-choice';
        button.dataset.choiceValue = String(choice.value ?? index);
        button.textContent = String(choice.label ?? choice.value ?? '');
        /* A second line for choices that need one. Set as text, never markup:
           these strings come from callers and one day one of them will come
           from something a user typed. */
        if (choice.hint) {
          const hint = document.createElement('small');
          hint.className = 'poorija-dialog-choice-hint';
          hint.textContent = String(choice.hint);
          button.appendChild(hint);
        }
        choicesEl.appendChild(button);
      });
    }
    const wantsInput = config.kind === 'prompt';
    input.classList.toggle('hidden', !wantsInput);
    input.type = config.password ? 'password' : 'text';
    input.value = wantsInput ? String(config.defaultValue ?? '') : '';
    if (config.inputMode) input.inputMode = config.inputMode;
    else input.removeAttribute('inputmode');
    input.placeholder = config.placeholder || '';
    confirmInput.classList.toggle('hidden', !wantsInput || !config.confirmPassword);
    confirmInput.value = '';
    confirmInput.type = 'password';
    confirmInput.placeholder = language() === 'fa' ? 'تکرار رمز عبور' : 'Repeat password';
    confirmInput.setAttribute('aria-label', confirmInput.placeholder);
    input.setAttribute('aria-label', config.placeholder || titleEl.textContent);

    dialog.classList.toggle('is-password-dialog', wantsInput && Boolean(config.password));
    for (const field of [input, confirmInput]) {
      let wrap = field.parentElement;
      if (!wrap.classList.contains('password-control')) {
        wrap = document.createElement('div'); wrap.className = 'password-control';
        field.before(wrap); wrap.append(field);
        const tools = document.createElement('span'); tools.className = 'password-control-tools';
        tools.innerHTML = '<button type="button" data-password-keyboard><i class="fas fa-keyboard"></i></button><button type="button" data-password-eye aria-pressed="false"><i class="fas fa-eye"></i></button>';
        wrap.append(tools);
      }
      wrap.classList.toggle('hidden', field.classList.contains('hidden'));
      const tools = wrap.querySelector('.password-control-tools');
      tools.classList.toggle('hidden', !config.password);
      const eye = tools.querySelector('[data-password-eye]');
      eye.classList.toggle('poorija-dialog-reveal', field === input);
      eye.innerHTML = '<i class="fas fa-eye"></i>';
      eye.setAttribute('aria-pressed', 'false');
      eye.setAttribute('aria-label', language() === 'fa' ? 'نمایش رمز عبور' : 'Show password');
      eye.onclick = () => {
        global.togglePasswordVisibility(field.id, eye);
        eye.setAttribute('aria-pressed', String(field.type === 'text'));
      };
      const keyboard = tools.querySelector('[data-password-keyboard]');
      keyboard.setAttribute('aria-label', language() === 'fa' ? 'کیبورد مجازی' : 'Virtual keyboard');
      keyboard.onclick = () => global.toggleVirtualKeyboard(field.id);
    }
    reveal?.remove();

    errorEl.textContent = '';
    errorEl.classList.add('hidden');

    node.dir = document.documentElement.dir || 'rtl';
    node.classList.remove('hidden');
    /* The frame delay lets the transition run from the hidden state instead
       of snapping straight to the final one. */
    requestAnimationFrame(() => node.classList.add('is-open'));

    const previousFocus = document.activeElement;
    generation += 1;
    const myGeneration = generation;

    return new Promise((resolve) => {
      let settled = false;

      const close = (value) => {
        if (settled) return;
        settled = true;
        node.classList.remove('is-open');
        if ([input.id, confirmInput.id].includes(global.currentVkTargetId)) document.getElementById('virtualKeyboardContainer')?.classList.add('hidden');
        document.removeEventListener('keydown', onKeyDown, true);
        node.removeEventListener('pointerdown', onBackdrop);
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        choicesEl.removeEventListener('click', onChoice);
        setTimeout(() => {
          if (generation !== myGeneration) return;
          node.classList.add('hidden');
          input.value = '';
          confirmInput.value = '';
          input.type = confirmInput.type = 'password';
        }, 160);
        try { previousFocus?.focus?.(); } catch (error) { /* gone from the DOM */ }
        resolve(value);
      };

      const onChoice = (event) => {
        const button = event.target.closest('.poorija-dialog-choice');
        if (button) close(button.dataset.choiceValue);
      };
      if (wantsChoices) choicesEl.addEventListener('click', onChoice);

      const onOk = () => {
        if (wantsChoices) return close(null);
        if (!wantsInput) return close(config.kind === 'alert' ? undefined : true);
        const value = input.value;
        const problem = config.confirmPassword && value !== confirmInput.value
          ? (language() === 'fa' ? 'دو رمز عبور یکسان نیستند.' : 'The passwords do not match.')
          : (typeof config.validate === 'function' ? config.validate(value) : '');
        if (problem) {
          errorEl.textContent = problem;
          errorEl.classList.remove('hidden');
          input.focus();
          input.select?.();
          return;
        }
        close(value);
      };
      const onCancel = () => close(config.kind === 'prompt' || config.kind === 'choose' ? null : false);

      const onKeyDown = (event) => {
        if (node.classList.contains('hidden')) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
          return;
        }
        if (event.key === 'Enter' && (document.activeElement === input || document.activeElement === confirmInput || document.activeElement === okBtn)) {
          event.preventDefault();
          event.stopPropagation();
          onOk();
          return;
        }
        /* Keep Tab inside the dialog. Without this the focus ring walks off
           into the page behind it, which on a confirmation is how someone
           ends up pressing a button they cannot see. */
        if (event.key === 'Tab') {
          const focusable = [...dialog.querySelectorAll('input, button'), ...document.querySelectorAll('#virtualKeyboardContainer button')].filter(el => el.getClientRects().length && !el.disabled);
          if (!focusable.length) return;
          const index = focusable.indexOf(document.activeElement);
          const next = event.shiftKey
            ? focusable[(index <= 0 ? focusable.length : index) - 1]
            : focusable[(index + 1) % focusable.length];
          event.preventDefault();
          next.focus();
        }
      };

      const onBackdrop = (event) => {
        if (event.target === node) onCancel();
      };

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      node.addEventListener('pointerdown', onBackdrop);
      document.addEventListener('keydown', onKeyDown, true);

      setTimeout(() => {
        if (wantsInput) {
          input.focus();
          input.select?.();
        } else {
          okBtn.focus();
        }
      }, 40);
      void dialog.offsetHeight;
    });
  }

  function queue(config) {
    const run = chain.then(() => open(config));
    /* The chain must survive a rejection, or one failed dialog would wedge
       every dialog after it. */
    chain = run.catch(() => {});
    return run;
  }

  /* `options` also accepts a bare string, so the call sites read the same as
     the window.prompt() they replaced. */
  function normalize(options, kind) {
    if (typeof options === 'string' || typeof options === 'number') {
      return { defaultValue: String(options), kind };
    }
    return { ...(options || {}), kind };
  }

  const api = {
    alert(message, options) {
      return queue({ ...normalize(options, 'alert'), message });
    },
    confirm(message, options) {
      return queue({ ...normalize(options, 'confirm'), message });
    },
    prompt(message, options) {
      return queue({ ...normalize(options, 'prompt'), message });
    },
    /* Resolves to the chosen value, or null if the reader backed out. */
    choose(message, choices, options) {
      return queue({ ...normalize(options, 'choose'), message, choices, okLabel: (options && options.cancelLabel) || undefined });
    },
    /* True when the platform's own dialogs are unusable, which is what makes
       these replacements mandatory rather than cosmetic. */
    nativeDialogsAreBroken() {
      return Boolean(global.__POORIJA_DESKTOP__);
    },
  };

  global.PoorijaDialogs = api;
}(typeof globalThis !== 'undefined' ? globalThis : window));
