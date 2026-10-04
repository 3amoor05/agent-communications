import { createHash } from 'node:crypto';
import type {
  Config,
  PendingRevocation,
  PendingRevocationStatus,
  PendingRevocationTokenState,
  SecretStore,
  SecretStoreKind,
} from '@agentcomms/core';
import { APPROVAL_KEY_REF, CommsError, withCredentialsLock, writeOutcome } from '@agentcomms/core';
import { callSlack, type SlackResponse } from '../api/call.ts';
import { closedPermit, revokeWith } from '../api/guard.ts';
import { parseBundle, type TokenBundle } from '../auth/bundle.ts';
import type { SlackContext } from '../context.ts';

/** The longest a profile-app token can remain usable when its own stored expiry cannot be read. */
export const REVOCATION_FALLBACK_MS: number = 30 * 24 * 60 * 60_000;

export type RevocationTokenKind = 'access' | 'refresh';

export interface CreatePendingRevocation {
  readonly ref: string;
  readonly store: SecretStoreKind;
  readonly workspace: string;
  readonly createdAt: string;
  readonly bundle: TokenBundle;
}

function fixedDeadline(value: string | undefined, createdAt: string): string {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return new Date(Date.parse(createdAt) + REVOCATION_FALLBACK_MS).toISOString();
}

function pending(deadline: string): PendingRevocationTokenState {
  return Object.freeze({ status: 'pending', deadline });
}

/** Creates the durable ledger row before either bearer is presented to Slack. */
export function createPendingRevocation(input: CreatePendingRevocation): PendingRevocation {
  const access = pending(fixedDeadline(input.bundle.accessExpiresAt, input.createdAt));
  const refresh =
    input.bundle.refreshToken === undefined
      ? undefined
      : pending(fixedDeadline(input.bundle.refreshExpiresAt, input.createdAt));
  const tokens = Object.freeze({ access, ...(refresh === undefined ? {} : { refresh }) });
  return Object.freeze({
    ref: input.ref,
    store: input.store,
    platform: 'slack',
    workspace: input.workspace,
    createdAt: input.createdAt,
    tokens,
  });
}

export interface PendingRevocationToken {
  readonly kind: RevocationTokenKind;
  readonly state: PendingRevocationTokenState;
}

/** Access first and refresh second, as two independent token states. */
export function pendingRevocationTokens(entry: PendingRevocation): readonly PendingRevocationToken[] {
  const access = Object.freeze({ kind: 'access' as const, state: Object.freeze({ ...entry.tokens.access }) });
  const refresh = entry.tokens.refresh;
  return Object.freeze([
    access,
    ...(refresh === undefined
      ? []
      : [Object.freeze({ kind: 'refresh' as const, state: Object.freeze({ ...refresh }) })]),
  ]);
}

export interface RevocationResponse {
  readonly ok?: unknown;
  readonly revoked?: unknown;
  readonly error?: unknown;
}

/** Structured evidence retained from the one bounded call. Anything not conclusive remains pending. */
export type RevocationEvidence =
  | { readonly kind: 'response'; readonly response: RevocationResponse }
  | { readonly kind: 'http'; readonly status: number; readonly response?: RevocationResponse | undefined }
  | { readonly kind: 'network' }
  | { readonly kind: 'unreadable' };

/**
 * Classifies one token without changing its pair.
 *
 * A fixed deadline wins before an answer is considered because the executor never calls Slack at or beyond it.
 * Final states are sticky: a later retry cannot turn conclusive evidence back into pending.
 */
export function classifyRevocationAnswer(
  state: PendingRevocationTokenState,
  evidence: RevocationEvidence,
  now: Date,
): PendingRevocationTokenState {
  let status: PendingRevocationStatus = state.status;
  if (status === 'pending') {
    const deadline = Date.parse(state.deadline);
    if (Number.isFinite(deadline) && now.getTime() >= deadline) {
      status = 'expired';
    } else if (evidence.kind === 'response') {
      const answer = evidence.response;
      if (
        (answer.ok === true && answer.revoked === true) ||
        (answer.ok === false && (answer.error === 'token_revoked' || answer.error === 'token_expired'))
      ) {
        status = 'revoked';
      }
    }
  }
  return Object.freeze({ status, deadline: state.deadline });
}

/** The non-secret state returned by cleanup and doctor results. */
export interface RevocationTokenResult {
  readonly kind: RevocationTokenKind;
  readonly status: PendingRevocationStatus;
  readonly deadline: string;
}

export function revocationTokenResult(
  kind: RevocationTokenKind,
  state: PendingRevocationTokenState,
): RevocationTokenResult {
  return Object.freeze({ kind, status: state.status, deadline: state.deadline });
}

export interface RevocationIssue {
  readonly code: string;
  readonly message: string;
}

/** A non-secret result for one durable ledger entry. */
export interface PendingRevocationResult {
  readonly ref: string;
  readonly platform: string;
  readonly workspace: string;
  readonly tokens: readonly RevocationTokenResult[];
  /** True only after the old bundle was deleted and this exact ledger entry was removed. */
  readonly cleaned: boolean;
  readonly issue?: RevocationIssue | undefined;
}

export function pendingRevocationResult(
  entry: PendingRevocation,
  cleaned: boolean,
  issue?: RevocationIssue,
): PendingRevocationResult {
  return Object.freeze({
    ref: entry.ref,
    platform: entry.platform,
    workspace: entry.workspace,
    tokens: Object.freeze(pendingRevocationTokens(entry).map(({ kind, state }) => revocationTokenResult(kind, state))),
    cleaned,
    ...(issue === undefined ? {} : { issue: Object.freeze(issue) }),
  });
}

const resultOf = pendingRevocationResult;

function entriesNamed(config: Config, ref: string): Array<{ index: number; entry: PendingRevocation }> {
  const found: Array<{ index: number; entry: PendingRevocation }> = [];
  for (const [index, entry] of (config.pendingRevocations ?? []).entries()) {
    if (entry.platform === 'slack' && entry.ref === ref) found.push({ index, entry });
  }
  return found;
}

function requireEntry(config: Config, ref: string): { index: number; entry: PendingRevocation } {
  const found = entriesNamed(config, ref);
  if (found.length === 0) throw new CommsError('NOT_FOUND', 'no pending Slack revocation has that reference');
  if (found.length !== 1) {
    throw new CommsError('CONFIG', 'more than one pending Slack revocation names the same reference');
  }
  return found[0] as { index: number; entry: PendingRevocation };
}

function sameEntry(left: PendingRevocation, right: PendingRevocation): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function refIsUnowned(config: Config, ref: string): boolean {
  return (
    ref !== APPROVAL_KEY_REF &&
    !Object.values(config.clients).some((client) => client.secretRef === ref) &&
    !Object.values(config.inboxes).some((inbox) => inbox.secretRef === ref) &&
    !Object.values(config.accounts).some((account) => account.secretRef === ref) &&
    !(config.pendingRevocations ?? []).some((entry) => entry.ref === ref)
  );
}

function requireExclusivePendingRef(config: Config, expected: PendingRevocation): void {
  const owners = (config.pendingRevocations ?? []).filter((entry) => entry.ref === expected.ref);
  const onlyThisEntry = owners.length === 1 && owners[0] !== undefined && sameEntry(owners[0], expected);
  const liveOwner =
    expected.ref === APPROVAL_KEY_REF ||
    Object.values(config.clients).some((client) => client.secretRef === expected.ref) ||
    Object.values(config.inboxes).some((inbox) => inbox.secretRef === expected.ref) ||
    Object.values(config.accounts).some((account) => account.secretRef === expected.ref);
  if (!onlyThisEntry || liveOwner) {
    throw new CommsError('CONFIG', 'the pending credential reference is not exclusive to this revocation entry');
  }
}

function tokenState(entry: PendingRevocation, kind: RevocationTokenKind): PendingRevocationTokenState | undefined {
  return kind === 'access' ? entry.tokens.access : entry.tokens.refresh;
}

interface PreparedToken {
  readonly entry: PendingRevocation;
  readonly kind: RevocationTokenKind;
  readonly state: PendingRevocationTokenState;
  readonly token?: string | undefined;
  readonly issue?: RevocationIssue | undefined;
}

async function prepareToken(
  context: SlackContext,
  ref: string,
  kind: RevocationTokenKind,
): Promise<PreparedToken | null> {
  return withCredentialsLock(context.core.paths.configDir, async () => {
    const config = await context.config();
    const { entry } = requireEntry(config, ref);
    requireExclusivePendingRef(config, entry);
    const state = tokenState(entry, kind);
    if (state === undefined) return null;
    if (state.status !== 'pending' || context.now().getTime() >= Date.parse(state.deadline)) {
      return { entry, kind, state };
    }
    try {
      const store = await context.core.secrets(entry.store);
      const raw = await store.get(entry.ref);
      if (raw === null) {
        return {
          entry,
          kind,
          state,
          issue: { code: 'NOT_FOUND', message: 'the pending credential bundle is missing from its recorded store' },
        };
      }
      const bundle = parseBundle(raw);
      if (bundle === null) {
        return {
          entry,
          kind,
          state,
          issue: { code: 'NOT_FOUND', message: 'the pending credential bundle is missing from its recorded store' },
        };
      }
      const token = kind === 'access' ? bundle.accessToken : bundle.refreshToken;
      if (typeof token !== 'string' || token.length === 0) {
        return {
          entry,
          kind,
          state,
          issue: { code: 'BAD_DATA', message: `the pending credential bundle has no ${kind} token` },
        };
      }
      return { entry, kind, state, token };
    } catch (error) {
      const code = error instanceof CommsError ? error.code : 'UNEXPECTED';
      return {
        entry,
        kind,
        state,
        issue: { code, message: 'the pending credential bundle could not be read from its recorded store' },
      };
    }
  });
}

function evidenceFromError(error: unknown): RevocationEvidence {
  if (error instanceof CommsError) {
    const slackError = error.details?.slackError;
    if (typeof slackError === 'string') return { kind: 'response', response: { ok: false, error: slackError } };
    const status = error.details?.httpStatus;
    if (typeof status === 'number') return { kind: 'http', status };
    if (error.code === 'PROVIDER_UNAVAILABLE') return { kind: 'unreadable' };
  }
  return { kind: 'network' };
}

async function revokeOne(context: SlackContext, prepared: PreparedToken): Promise<PendingRevocationTokenState> {
  let evidence: RevocationEvidence = { kind: 'network' };
  if (prepared.token !== undefined && context.now().getTime() < Date.parse(prepared.state.deadline)) {
    const permit = closedPermit();
    const digest = createHash('sha256').update(prepared.token).digest('hex');
    try {
      const response: SlackResponse = await revokeWith(
        permit,
        'auth.revoke',
        { ref: prepared.entry.ref, kind: prepared.kind, tokenSha256: digest },
        () =>
          callSlack(
            {
              token: prepared.token as string,
              permit,
              revocation: { ref: prepared.entry.ref, kind: prepared.kind },
              fetch: context.fetch,
              baseUrl: context.slackBaseUrl,
              timeoutMs: 30_000,
            },
            'auth.revoke',
          ),
      );
      evidence = { kind: 'response', response };
    } catch (error) {
      evidence = evidenceFromError(error);
    }
  }
  return classifyRevocationAnswer(prepared.state, evidence, context.now());
}

function sameEntryAndPending(current: PendingRevocation, expected: PreparedToken): PendingRevocationTokenState | null {
  if (
    current.ref !== expected.entry.ref ||
    current.store !== expected.entry.store ||
    current.platform !== expected.entry.platform ||
    current.workspace !== expected.entry.workspace ||
    current.createdAt !== expected.entry.createdAt
  ) {
    return null;
  }
  const state = tokenState(current, expected.kind);
  if (state?.status !== 'pending' || state.deadline !== expected.state.deadline) return null;
  return state;
}

async function persistTokenState(
  context: SlackContext,
  expected: PreparedToken,
  nextState: PendingRevocationTokenState,
): Promise<PendingRevocation> {
  return withCredentialsLock(context.core.paths.configDir, async () => {
    let written: PendingRevocation | undefined;
    await context.core.config.update((config) => {
      const { index, entry } = requireEntry(config, expected.entry.ref);
      requireExclusivePendingRef(config, entry);
      if (sameEntryAndPending(entry, expected) === null) {
        throw new CommsError('TRANSIENT', 'the pending revocation changed while its token was being revoked');
      }
      written = {
        ...entry,
        tokens:
          expected.kind === 'access' ? { ...entry.tokens, access: nextState } : { ...entry.tokens, refresh: nextState },
      };
      const pendingRevocations = [...(config.pendingRevocations ?? [])];
      pendingRevocations[index] = written;
      return { ...config, pendingRevocations };
    });
    return written as PendingRevocation;
  });
}

async function cleanFinished(context: SlackContext, ref: string): Promise<PendingRevocationResult> {
  return withCredentialsLock(context.core.paths.configDir, async () => {
    const config = await context.config();
    const { index, entry } = requireEntry(config, ref);
    requireExclusivePendingRef(config, entry);
    if (pendingRevocationTokens(entry).some(({ state }) => state.status === 'pending')) return resultOf(entry, false);
    let store: SecretStore;
    let raw: string | null;
    try {
      store = await context.core.secrets(entry.store);
      raw = await store.get(entry.ref);
    } catch {
      return resultOf(entry, false, {
        code: 'SECRET_STORE_UNAVAILABLE',
        message: 'the finished credential bundle could not be read from its recorded store before cleanup',
      });
    }
    if (raw !== null) {
      try {
        await store.delete(entry.ref);
      } catch {
        return resultOf(entry, false, {
          code: 'SECRET_STORE_UNAVAILABLE',
          message: 'the finished credential bundle could not be deleted from its recorded store',
        });
      }
    }
    try {
      await context.core.config.update((current) => {
        const found = requireEntry(current, ref);
        requireExclusivePendingRef(current, found.entry);
        if (found.index !== index || !sameEntry(found.entry, entry)) {
          throw new CommsError('TRANSIENT', 'the pending revocation changed before its bundle could be cleaned up');
        }
        const pendingRevocations = [...(current.pendingRevocations ?? [])];
        pendingRevocations.splice(index, 1);
        return {
          ...current,
          pendingRevocations: pendingRevocations.length === 0 ? undefined : pendingRevocations,
        };
      });
    } catch {
      const landed = await writeOutcome(async () => refIsUnowned(await context.config(), ref));
      if (landed === 'present') return resultOf(entry, true);
      if (raw !== null) {
        try {
          await store.set(entry.ref, raw);
          if ((await store.get(entry.ref)) !== raw) throw new Error('the restored bundle did not verify');
        } catch {
          return resultOf(entry, false, {
            code: 'SECRET_STORE_UNAVAILABLE',
            message: 'the bundle could not be restored after its ledger entry failed to be removed',
          });
        }
      }
      return resultOf(entry, false, {
        code: landed === 'absent' ? 'CONFIG_WRITE_FAILED' : 'CONFIG_OUTCOME_UNKNOWN',
        message:
          landed === 'absent'
            ? 'the finished ledger entry could not be removed, so its bundle was kept'
            : 'whether the finished ledger entry was removed could not be confirmed, so its bundle was kept',
      });
    }
    return resultOf(entry, true);
  });
}

/** Revokes the access and refresh halves of one ledger entry independently, then cleans it up when both are final. */
export async function revokePendingEntry(context: SlackContext, ref: string): Promise<PendingRevocationResult> {
  if (typeof ref !== 'string') {
    throw new CommsError('USAGE', 'a pending reference must be passed by name; a token is never accepted');
  }
  let last: PendingRevocation | undefined;
  for (const kind of ['access', 'refresh'] as const) {
    const prepared = await prepareToken(context, ref, kind);
    if (prepared === null) continue;
    last = prepared.entry;
    if (prepared.issue !== undefined) return resultOf(prepared.entry, false, prepared.issue);
    if (prepared.state.status !== 'pending') continue;
    const next = await revokeOne(context, prepared);
    last = await persistTokenState(context, prepared, next);
  }
  if (last === undefined) {
    const { entry } = requireEntry(await context.config(), ref);
    last = entry;
  }
  return cleanFinished(context, last.ref);
}

/** Retries each Slack ledger entry independently, in its stored order. */
export async function retryPendingRevocations(
  context: SlackContext,
  workspace?: string,
): Promise<readonly PendingRevocationResult[]> {
  const entries =
    (await context.config()).pendingRevocations?.filter(
      (entry) => entry.platform === 'slack' && (workspace === undefined || entry.workspace === workspace),
    ) ?? [];
  const refs = [...new Set(entries.map((entry) => entry.ref))];
  const results: PendingRevocationResult[] = [];
  for (const ref of refs) {
    const snapshot = entries.find((entry) => entry.ref === ref) as PendingRevocation;
    try {
      results.push(await revokePendingEntry(context, ref));
    } catch (error) {
      if (
        error instanceof CommsError &&
        error.code === 'NOT_FOUND' &&
        (await writeOutcome(
          async () => !(await context.config()).pendingRevocations?.some((entry) => entry.ref === ref),
        )) === 'present'
      ) {
        continue;
      }
      results.push(
        resultOf(snapshot, false, {
          code: error instanceof CommsError ? error.code : 'UNEXPECTED',
          message: 'this pending revocation could not be retried; later entries were still attempted',
        }),
      );
    }
  }
  return Object.freeze(results);
}
