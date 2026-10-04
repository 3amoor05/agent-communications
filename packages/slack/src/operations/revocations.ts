import type {
  PendingRevocation,
  PendingRevocationStatus,
  PendingRevocationTokenState,
  SecretStoreKind,
} from '@agentcomms/core';
import type { TokenBundle } from '../auth/bundle.ts';

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
