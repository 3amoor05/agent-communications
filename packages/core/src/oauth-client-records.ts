import { type ClientConfig, type Config, type StoreKind, secretsStoreFor } from './config.ts';
import { CommsError } from './errors.ts';
import type { HandoffMaker } from './handoff-text.ts';
import { keepAndReport, writeOutcome } from './reconcile.ts';
import { type KeyringModule, probeKeychain, type SecretStore } from './secrets.ts';

/**
 * The records of a Google OAuth client on this machine: its row in `config.clients`, and its secret in the store.
 *
 * These lived in the Gmail package, beside `client add`, which was the only thing that wrote them. An organisation
 * profile writes them too (design 2026-10-02 §D5), and the core owns that operation — and the core does not depend on
 * the Gmail package, Gmail depends on the core. So the pieces both need are here, and `client add` imports them: one
 * client-id check, one way to name a client's secret, one shape of row, and one procedure for writing a secret beside
 * the configuration that names it. Two copies of the last one would be two answers to "what if the write fails".
 *
 * Nothing here talks to Google: probing a client's credentials stays in the Gmail package, which owns the endpoints.
 */

/** What every Google OAuth client id ends with. */
export const GOOGLE_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

/**
 * A Google client id as an organisation profile has to write it (design 2026-10-02 §D2): the project number, a hyphen,
 * the client's own part, and Google's suffix — and nothing else.
 *
 * Stricter than `isGoogleClientId`, which `client add` has always used and still does: a downloaded client file comes
 * from Google, while a profile is written by a person, and every field of it has a grammar and a bound.
 */
export const GOOGLE_CLIENT_ID_PATTERN: RegExp = /^[0-9]{1,30}-[a-z0-9]{1,64}\.apps\.googleusercontent\.com$/;

/**
 * Whether a value from a downloaded client file is a Google client id at all — the check `client add` makes, unchanged:
 * the suffix, which every client id Google issues carries.
 */
export function isGoogleClientId(value: unknown): value is string {
  return typeof value === 'string' && value.endsWith(GOOGLE_CLIENT_ID_SUFFIX);
}

/**
 * Where a client's secret is kept: derived from the client's name, so the Gmail session finds it from `inbox.client`
 * alone. A client re-registered under the same name — a rotation, a repair — writes the same reference.
 */
export function clientSecretRef(name: string): string {
  return `client:${name}:secret`;
}

/** A Gmail client's row as the configuration holds it, its secret named by `clientSecretRef(name)`. */
export function gmailClientRow(input: {
  name: string;
  clientId: string;
  projectId?: string | undefined;
  addedAt: string;
  /** The organisation profile that owns the row (design 2026-10-02 §D4); absent on a row a person registered. */
  organisation?: string | undefined;
}): ClientConfig {
  return {
    provider: 'gmail',
    clientId: input.clientId,
    projectId: input.projectId,
    secretRef: clientSecretRef(input.name),
    addedAt: input.addedAt,
    ...(input.organisation === undefined ? {} : { organisation: input.organisation }),
  };
}

/**
 * The store a command that writes a secret keeps it in: the one the configuration already uses — recorded, or the
 * keychain a Slack token already sits in — or, when nothing is stored yet, the one asked for, after proving the
 * keychain works when that is the one. A different one is refused before anybody is asked to approve it
 * (`secretsStoreFor`): switching here would record a store and move nothing.
 *
 * `keyring` is for a test: the real module writes, reads and deletes an item in the login keychain, and a test must
 * never touch it. Left out, the real one is loaded.
 */
export async function chooseSecretStore(
  config: Config,
  requested: StoreKind | undefined,
  options: {
    keyring?: KeyringModule | null | undefined;
    platform?: NodeJS.Platform | undefined;
    /** The caller's handoffs, for the command a refusal names (CUE-403); they carry their platform. */
    handoffs?: HandoffMaker | undefined;
  } = {},
): Promise<{ store: StoreKind; choosing: boolean }> {
  const chosen: { store: StoreKind; choosing: boolean } = secretsStoreFor(
    config,
    requested,
    options.handoffs ?? options.platform,
  );
  if (!chosen.choosing || chosen.store !== 'keychain') return chosen;
  // `null` is a machine without the module, answered here: `probeKeychain` loads the real one when handed none.
  const probe =
    options.keyring === null
      ? { ok: false, reason: 'the optional @napi-rs/keyring package is not installed for this platform' }
      : await probeKeychain(options.keyring);
  if (!probe.ok) {
    throw new CommsError('SECRET_STORE_UNAVAILABLE', `the system keychain cannot be used here: ${probe.reason}`, {
      hint: 'Run the command again with `--store file` to keep secrets in owner-only files in the config directory.',
    });
  }
  return chosen;
}

export interface SecretWriteOptions {
  secrets: SecretStore;
  secretRef: string;
  secret: string;
  /**
   * Writes the configuration that names the secret — one `ConfigStore.update`. Call `refuse(true)` as the mutator
   * starts and `refuse(false)` as it accepts: a write that refused itself is told apart from one that failed around
   * itself, because re-writing a row identical to the one there changes nothing, and a refusal would otherwise look
   * exactly like a write that landed.
   */
  commit: (refuse: (refused: boolean) => void) => Promise<void>;
  /**
   * Whether the configuration this call meant to write is the one there now, read fresh — asked only after the write
   * rejected, which does not prove it did not land (see `writeOutcome`). The secret is checked separately, after.
   */
  landed: () => Promise<boolean>;
  /** How a person checks whether it was saved, for a write whose outcome cannot be read: "Run `agent-gmail client list`." */
  howToCheck: string;
  /** How a person puts things right when the store cannot be put back as it was. */
  restoreHint: string;
}

/**
 * Writes a client secret and the configuration that names it, and on failure leaves the reference exactly as it was.
 *
 * The procedure `client add` has used since a failed registration left a secret under a name nothing used (design
 * 2026-10-02 §D4 makes it every client write's, an organisation's included):
 *
 * 1. **Keep what the reference holds now.** A name free in the configuration does not prove its reference is empty —
 *    an older registration, a removal whose deletion failed — so the earlier value is read first, and is what a
 *    failure puts back: the previous secret, or nothing.
 * 2. **Write the secret, read it back**, inside the boundary that puts it back: a keychain write can land after it has
 *    reported a timeout, so even a failed write is reconciled rather than assumed not to have happened.
 * 3. **Write the configuration.**
 * 4. **On any failure, ask whether it landed** (`writeOutcome`): the configuration as meant *and* the store holding the
 *    new secret, read fresh. Rotating a secret writes a row identical to the one there, so a row check alone answers
 *    "yes" before anything happened. Landed: keep it. Not landed: put the reference back. Cannot tell: keep it, and
 *    name the reference that may be left behind, because the cost of a wrong guess is a live secret deleted.
 *
 * The caller holds the credentials lock around this, and checks under it whatever its own change depends on.
 */
export async function writeSecretWithRestore(options: SecretWriteOptions): Promise<void> {
  const { secrets, secretRef, secret } = options;
  const previous = await secrets.get(secretRef);
  let refused = false;
  try {
    await secrets.set(secretRef, secret);
    const stored = await secrets.get(secretRef);
    if (stored !== secret) {
      throw new CommsError('SECRET_STORE_UNAVAILABLE', 'the secret did not read back the way it was written', {
        hint: 'Try again with `--store file` to keep secrets in owner-only files instead of the system keychain.',
      });
    }
    await options.commit((value) => {
      refused = value;
    });
  } catch (error) {
    const landed = refused
      ? ('absent' as const)
      : await writeOutcome(async () => {
          if (!(await options.landed())) return false;
          secrets.invalidate(secretRef);
          return (await secrets.get(secretRef)) === secret;
        });
    if (landed === 'unknown') throw keepAndReport(error, secretRef, options.howToCheck);
    if (landed === 'absent') {
      // Exactly as it was: the previous secret, or nothing when there was none.
      try {
        if (previous === null) await secrets.delete(secretRef);
        else await secrets.set(secretRef, previous);
      } catch (restoreError) {
        const base = error instanceof CommsError ? error : new CommsError('UNEXPECTED', String(error));
        throw new CommsError(base.code, base.message, {
          hint: `${base.hint ? `${base.hint} ` : ''}The secret store could not be put back as it was: ${options.restoreHint}`,
          details: { secretNotRestored: secretRef, restoreError: (restoreError as Error).message },
          cause: error,
        });
      }
    }
    if (landed !== 'present') throw error;
  }
}
