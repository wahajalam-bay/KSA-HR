'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { Icon } from '@/components/ui/icons';
import { Avatar } from '@/components/ui/primitives';
import { checkEmail, signIn, setPassword, type SignInState } from './actions';

/* ─────────────────────────────────────────────────────────────────────────────
   The sign-in screen.

   Three steps, the way the prototype had them: the address first, so the page
   can tell somebody who they are about to sign in as and whether they have been
   here before; then either the password they have, or the one they are choosing
   for the first time.

   Nothing on this page decides anything. Each step is a server action; the page
   renders what it is told, including the reason it was refused.
   ───────────────────────────────────────────────────────────────────────────*/

const START: SignInState = { step: 'email', email: '' };

export function SignInForm({ orgName, legalName, timezone, sso }: {
  orgName: string; legalName: string; timezone: string;
  sso: { available: boolean; reason?: string };
}) {
  const [emailState, doEmail, emailPending] = useActionState(checkEmail, START);
  const [signState, doSignIn, signPending] = useActionState(signIn, emailState);
  const [setState, doSetPw, setPending] = useActionState(setPassword, emailState);

  /* Whichever step ran last is the one on screen. */
  const state = signState.error ? { ...emailState, ...signState }
    : setState.error ? { ...emailState, ...setState }
      : emailState;
  const pending = emailPending || signPending || setPending;
  const step = state.step;
  const who = state.who;

  return (
    <div className="login" id="login">
      <div className="login-card">
        <div className="login-brand">
          <span className="logo"><Icon name="logo" size={22} sw={2} /></span>
          <span className="nm"><b>{orgName}</b><span>Talent Acquisition</span></span>
        </div>

        <h1 className="t-2">
          {step === 'email' ? `Welcome to ${orgName} Talent Acquisition`
            : step === 'set' ? `Welcome, ${first(who?.name)}`
              : `Welcome back, ${first(who?.name)}`}
        </h1>
        <p className="t-sub">
          {step === 'email'
            ? 'Good to see you. Sign in with your work e-mail to pick up where the team left off — '
              + 'access is by invitation, so only the TA team, hiring managers and interview participants '
              + 'added in the system can get in.'
            : step === 'set'
              ? 'Your account is ready — choose a password and you are in.'
              : 'Enter your password to continue.'}
        </p>

        {state.error && (
          <div className="banner bad" style={{ margin: '10px 0' }}>
            <span className="ic"><Icon name="alert" size={15} /></span>
            <div><b>{state.error}</b></div>
          </div>
        )}

        {step === 'email' && (
          <form action={doEmail} className="form" style={{ marginTop: 6 }}>
            <Field label="Work e-mail" name="email" type="email" defaultValue={state.email}
              placeholder="name@bayut.sa" autoComplete="username" autoFocus />
            <button className="btn pri block" type="submit" disabled={pending}>
              <Icon name="arrR" size={15} /> {pending ? 'Checking…' : 'Continue'}
            </button>
          </form>
        )}

        {step === 'password' && who && (
          <form action={doSignIn} className="form" style={{ marginTop: 6 }}>
            <Who who={who} />
            <input type="hidden" name="email" value={state.email} />
            <Field label="Password" name="password" type="password" placeholder="Your password"
              autoComplete="current-password" autoFocus />
            <button className="btn pri block" type="submit" disabled={pending}>
              <Icon name="login" size={15} /> {pending ? 'Signing in…' : 'Sign in'}
            </button>
            <BackButton />
          </form>
        )}

        {step === 'set' && who && (
          <form action={doSetPw} className="form" style={{ marginTop: 6 }}>
            <Who who={who} />
            <p className="t-sub">Welcome — this is your first sign-in. Choose a password for your account.</p>
            <input type="hidden" name="email" value={state.email} />
            <Field label="New password" name="password" type="password"
              placeholder="At least 12 characters" autoComplete="new-password" autoFocus />
            <Field label="Confirm password" name="password2" type="password"
              placeholder="Type it again" autoComplete="new-password" />
            <button className="btn pri block" type="submit" disabled={pending}>
              <Icon name="key" size={15} /> {pending ? 'Setting…' : 'Set password and sign in'}
            </button>
            <BackButton />
          </form>
        )}

        <div className="divider" style={{ margin: '16px 0 10px' }}><span className="t-over">Or</span></div>
        {sso.available ? (
          <a className="btn out block" href="/api/auth/oidc/start">
            <Icon name="shield" size={15} /> Sign in with single sign-on
          </a>
        ) : (
          <p className="t-foot" style={{ textAlign: 'center' }}>
            <Icon name="shield" size={12} /> {sso.reason}
          </p>
        )}
      </div>
      <p className="login-foot">{legalName}{timezone ? ` · ${timezone}` : ''}</p>
    </div>
  );
}

function Who({ who }: { who: NonNullable<SignInState['who']> }) {
  return (
    <div className="who">
      <Avatar person={{ name: who.name, photo: who.photo, hue: who.hue }} size="m" />
      <span><b>{who.name}</b><span>{who.title} · {who.email}</span></span>
    </div>
  );
}

function BackButton() {
  return (
    <button className="btn ghost block" type="button" onClick={() => window.location.reload()}>
      Use another e-mail
    </button>
  );
}

function Field({ label, name, type, defaultValue, placeholder, autoComplete, autoFocus }: {
  label: string; name: string; type: string; defaultValue?: string;
  placeholder?: string; autoComplete?: string; autoFocus?: boolean;
}) {
  const id = `lg_${name}`;
  return (
    <div className="field wide">
      <label htmlFor={id}>{label}</label>
      <input className="inp" id={id} name={name} type={type} defaultValue={defaultValue}
        placeholder={placeholder} autoComplete={autoComplete} autoFocus={autoFocus} required />
    </div>
  );
}

const first = (n?: string) => String(n ?? '').split(' ')[0];
