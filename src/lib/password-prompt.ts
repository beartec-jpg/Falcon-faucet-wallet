/**
 * Minimal, framework-free password dialog used when a passkey has no PRF support.
 * Built with DOM APIs (no inline script/HTML strings) so it works under a strict CSP.
 * Tests replace it with setWalletPasswordPrompter().
 */

import { validateWalletPassword } from '@/lib/wallet-key'

export type PasswordPromptMode = 'create' | 'enter' | 'migrate' | 'add-optional' | 'add'

export interface PasswordPromptRequest {
  mode: PasswordPromptMode
  /**
   * 'add-optional' (after the passkey step at wallet creation): resolves '' when the user
   * unticks "Add a password". Ticked by default.
   */
  /** Shown after a failed attempt. */
  error?: string
}

export type WalletPasswordPrompter = (req: PasswordPromptRequest) => Promise<string>

export class PasswordPromptCancelled extends Error {
  constructor() {
    super('Wallet password entry was cancelled')
    this.name = 'PasswordPromptCancelled'
  }
}

let prompter: WalletPasswordPrompter = domPrompter

export function setWalletPasswordPrompter(p: WalletPasswordPrompter | null): void {
  prompter = p ?? domPrompter
}

export function promptWalletPassword(req: PasswordPromptRequest): Promise<string> {
  return prompter(req)
}

const TEXT: Record<PasswordPromptMode, { title: string; body: string; button: string }> = {
  create: {
    title: 'Set a wallet password',
    body:
      'This passkey cannot produce an encryption key (no WebAuthn PRF support), so your wallet ' +
      'keys will be encrypted with a password. It is never sent anywhere and cannot be recovered: ' +
      'keep it with your encrypted backup.',
    button: 'Set password',
  },
  migrate: {
    title: 'Security upgrade: set a wallet password',
    body:
      'This wallet was saved with weak encryption that did not need a secret. Set a password now; ' +
      'your keys will be re-encrypted with it and the weak copy deleted. You will need it to unlock ' +
      'this wallet on this device.',
    button: 'Re-encrypt wallet',
  },
  'add-optional': {
    title: 'Add a password',
    body:
      'Optional extra protection: require this password as well as your passkey to unlock the wallet. ' +
      'It is never sent anywhere and cannot be recovered: keep it with your encrypted backup.',
    button: 'Continue',
  },
  add: {
    title: 'Add a wallet password',
    body:
      'From now on this wallet will need your passkey and this password to unlock. It is never sent ' +
      'anywhere and cannot be recovered: keep it with your encrypted backup.',
    button: 'Add password',
  },
  enter: {
    title: 'Wallet password',
    body: 'Enter the password that protects this wallet on this device.',
    button: 'Unlock',
  },
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  Object.assign(e.style, style)
  if (text) e.textContent = text
  return e
}

function domPrompter(req: PasswordPromptRequest): Promise<string> {
  if (typeof document === 'undefined') return Promise.reject(new Error('Password prompt needs a browser'))
  const t = TEXT[req.mode]
  const confirmNeeded = req.mode !== 'enter'
  return new Promise((resolve, reject) => {
    const overlay = el('div', {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.7)', zIndex: '2147483647',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
    })
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    const box = el('form', {
      background: '#0b1220', color: '#e5e7eb', border: '1px solid #334155', borderRadius: '12px',
      padding: '20px', maxWidth: '420px', width: '100%', fontFamily: 'inherit', fontSize: '14px',
    })
    box.appendChild(el('h2', { fontSize: '18px', margin: '0 0 8px', fontWeight: '600' }, t.title))
    box.appendChild(el('p', { margin: '0 0 12px', lineHeight: '1.4', color: '#cbd5e1' }, t.body))
    const inputStyle: Partial<CSSStyleDeclaration> = {
      width: '100%', boxSizing: 'border-box', padding: '10px', margin: '0 0 8px', borderRadius: '8px',
      border: '1px solid #475569', background: '#020617', color: '#f8fafc',
    }
    const optional = req.mode === 'add-optional'
    const toggle = el('input', {})
    toggle.type = 'checkbox'
    toggle.checked = true
    if (optional) {
      const lab = el('label', { display: 'flex', gap: '8px', alignItems: 'center', margin: '0 0 8px' })
      lab.append(toggle, document.createTextNode('Add a password'))
      box.appendChild(lab)
    }
    const pw = el('input', inputStyle)
    pw.type = 'password'
    pw.autocomplete = confirmNeeded ? 'new-password' : 'current-password'
    pw.placeholder = 'Password'
    box.appendChild(pw)
    const pw2 = el('input', inputStyle)
    pw2.type = 'password'
    pw2.autocomplete = 'new-password'
    pw2.placeholder = 'Confirm password'
    if (confirmNeeded) {
      box.appendChild(pw2)
      box.appendChild(el('p', { margin: '0 0 8px', color: '#94a3b8', fontSize: '12px' },
        'At least 12 characters, with 3 of: uppercase, lowercase, numbers, symbols.'))
    }
    const err = el('p', { margin: '0 0 8px', color: '#f87171', minHeight: '1em' }, req.error ?? '')
    box.appendChild(err)
    const row = el('div', { display: 'flex', gap: '8px', justifyContent: 'flex-end' })
    const cancel = el('button', { padding: '8px 14px', borderRadius: '8px', background: 'transparent', color: '#cbd5e1', border: '1px solid #475569' }, 'Cancel')
    cancel.type = 'button'
    const ok = el('button', { padding: '8px 14px', borderRadius: '8px', background: '#2563eb', color: '#fff', border: '0' }, t.button)
    ok.type = 'submit'
    row.append(cancel, ok)
    box.appendChild(row)
    overlay.appendChild(box)

    const done = () => overlay.remove()
    cancel.onclick = () => {
      done()
      reject(new PasswordPromptCancelled())
    }
    toggle.onchange = () => {
      pw.disabled = pw2.disabled = !toggle.checked
      err.textContent = ''
    }
    box.onsubmit = (ev) => {
      ev.preventDefault()
      if (optional && !toggle.checked) {
        done()
        resolve('')
        return
      }
      const v = pw.value
      if (confirmNeeded) {
        const problem = validateWalletPassword(v)
        if (problem) {
          err.textContent = problem
          return
        }
        if (v !== pw2.value) {
          err.textContent = 'Passwords do not match'
          return
        }
      } else if (!v) {
        err.textContent = 'Password required'
        return
      }
      done()
      resolve(v)
    }
    document.body.appendChild(overlay)
    pw.focus()
  })
}
