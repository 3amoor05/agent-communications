import type { ApprovalWait, WaitOptions, WaitProgress } from './operations/approval-wait.ts';

/**
 * What every surface's wait needs around the one operation (`waitForApproval`): the MCP call's cancellation and
 * progress, and a person's line at a terminal. Kept out of the operations module, which holds only what a command and
 * its tool both run.
 */

/**
 * What an MCP call hands every surface's wait tool: the request's cancellation, and its progress token — the one sign
 * the client wants progress — read from the call's `_meta`. Structural, so core names no SDK type it does not own.
 */
export interface WaitCallContext {
  readonly mcpReq: {
    readonly signal: AbortSignal;
    readonly _meta?: { readonly progressToken?: string | number | undefined } | undefined;
    notify(notification: { method: string; params?: Record<string, unknown> }): Promise<void>;
  };
}

/**
 * A wait tool's cancellation and progress, from its call (design 2026-10-05 §D3): the request's signal, so a client
 * that cancels — or goes away — ends the wait and frees its place; and progress every fifteen seconds only when the call
 * carried a progress token. A client that sent none hears nothing until the result.
 */
export function waitCallOptions(ctx: WaitCallContext): Pick<WaitOptions, 'signal' | 'onProgress'> {
  const token = ctx.mcpReq._meta?.progressToken;
  return {
    signal: ctx.mcpReq.signal,
    ...(token === undefined
      ? {}
      : {
          onProgress: (progress: WaitProgress) =>
            ctx.mcpReq.notify({
              method: 'notifications/progress',
              params: {
                progressToken: token,
                progress: progress.waitedSeconds,
                message: `still ${progress.state} after ${progress.waitedSeconds} seconds`,
              },
            }),
        }),
  };
}

/** A wait's result as one line or two for a person at a terminal: where it stands, and what to do next. */
export function renderApprovalWait(result: ApprovalWait): string {
  const where =
    result.state === 'cancelled'
      ? `the wait was cancelled; the approval is ${result.approval.state}`
      : result.claimable
        ? `${result.state}, and can be used now`
        : result.state;
  const reason = result.approval.reason === undefined ? '' : ` (${result.approval.reason})`;
  return [
    `${result.approvalId}: ${where}${reason}${result.waitedSeconds > 0 ? ` — waited ${result.waitedSeconds}s` : ''}`,
    ...(result.hint === undefined ? [] : [result.hint]),
  ].join('\n');
}
