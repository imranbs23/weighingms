/**
 * SignInScreen — the terminal's sign-in.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE SCREEN ASKS FOR A CREDENTIAL. IT NEVER JUDGES THE OPERATOR.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"Rendering the sign-in screen → `007-weighingms-ui`"* (unit 008), and
 * *"the signed-in operator chip in the top bar"* — so this unit draws it.
 *
 * **And the failure is ONE failure.** The API answers every credential
 * failure with the same `AUTHENTICATION_FAILED` — unknown operator, wrong
 * secret, deactivated operator — and the screen says the same thing for
 * every one of them. **A sign-in screen that said "no such operator" would
 * be an identity oracle**, and the operator would learn which operator ids
 * exist by watching what the screen refused.
 *
 * AND NO OPERATOR-FACING LITERAL IS HERE
 * --------------------------------------
 * Every label, caption and message is a **locale key** — so a language is
 * changeable without a redeployment (BRD FR-22, NFR-11).
 *
 * AND THE TOUCH TARGETS ARE ≥ 15 mm
 * --------------------------------
 * A gloved operator at a machine is the reason the design specifies a
 * minimum, and a disabled-looking control with no reason is a support call
 * (NFR-4, BRD NFR-07).
 */
import { useState } from 'react';
import { useStrings } from '../../i18n/useStrings.js';
import { useIdentityStore } from '../../state/identity-store.js';
import {
  COLOURS,
  MIN_LABEL_PX,
  SPACING,
  TOUCH_TARGET_PX,
} from '../batch-queue/tokens.js';

/** Every locale key the sign-in screen uses. */
export const SIGN_IN_KEYS = [
  'identity.signIn.title',
  'identity.signIn.operatorId',
  'identity.signIn.secret',
  'identity.signIn.submit',
  'identity.signIn.refused',
  'identity.signIn.apiUnreachable',
] as const;

export function SignInScreen(): React.JSX.Element {
  const t = useStrings(SIGN_IN_KEYS);

  const busy = useIdentityStore((s) => s.busy);
  const failure = useIdentityStore((s) => s.failure);
  const signIn = useIdentityStore((s) => s.signIn);

  const [operatorId, setOperatorId] = useState('');
  const [secret, setSecret] = useState('');

  const onSubmit = async (): Promise<void> => {
    // The credential is sent and **not kept** — the field is cleared, so
    // the secret is not sitting in the DOM behind the operator's back.
    await signIn(operatorId, secret);
    setSecret('');
  };

  return (
    <div className="sign-in-wrap">
      <main
        className="sign-in"
        data-testid="sign-in-screen"
        style={{ fontSize: `${MIN_LABEL_PX}px` }}
      >
        <h1 style={{ fontSize: `${MIN_LABEL_PX * 1.4}px`, margin: 0 }}>
          {t('identity.signIn.title')}
        </h1>

        {/* THE REFUSAL — and it names NO cause. One message for every
            credential failure, so the screen is not an identity oracle. */}
        {failure !== null && (
          <p
            data-testid="sign-in-failure"
            role="alert"
            style={{ color: COLOURS.danger }}
          >
            {t(failure)}
          </p>
        )}

        <label style={{ display: 'block', marginTop: SPACING.md }}>
          {t('identity.signIn.operatorId')}
          <input
            data-testid="sign-in-operator-id"
            value={operatorId}
            onChange={(event) => setOperatorId(event.target.value)}
            style={{
              display: 'block',
              width: '100%',
              minHeight: `${TOUCH_TARGET_PX}px`,
              fontSize: `${MIN_LABEL_PX}px`,
            }}
          />
        </label>

        <label style={{ display: 'block', marginTop: SPACING.md }}>
          {t('identity.signIn.secret')}
          <input
            type="password"
            data-testid="sign-in-secret"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            style={{
              display: 'block',
              width: '100%',
              minHeight: `${TOUCH_TARGET_PX}px`,
              fontSize: `${MIN_LABEL_PX}px`,
            }}
          />
        </label>

        <button
          type="button"
          className="key ok"
          data-testid="sign-in-submit"
          onClick={() => {
            void onSubmit();
          }}
          disabled={busy || operatorId.trim() === '' || secret === ''}
          style={{
            marginTop: SPACING.md,
            minHeight: `${TOUCH_TARGET_PX}px`,
            fontSize: `${MIN_LABEL_PX}px`,
          }}
        >
          {t('identity.signIn.submit')}
        </button>
      </main>
    </div>
  );
}
