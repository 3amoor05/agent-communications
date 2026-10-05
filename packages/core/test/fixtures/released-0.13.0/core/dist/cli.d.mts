import { J as openCore } from "./change-flow-DxZfblwU.mjs";
//#region src/operations/attach-settings.d.ts
/**
 * Which local files may be attached — to a Gmail draft, a Resend email, a Slack post: the folders they may come from
 * (`defaults.attachRoots`), the paths they never may (`defaults.attachDeny`, on top of the built-in list the jail always
 * applies), reported and changed from a terminal (`agentcomms attach`) or a chat (`comms_attach`), one operation.
 *
 * Nothing did this before (issue #45). The jail's refusal said to copy the file under the home folder, because the only
 * other way was editing the configuration by hand. Changing the lists is a change like any other, through the one flow:
 * a folder added, or a deny entry taken away, widens what an agent can read off this disk and send to somebody, so
 * `classifyChange` counts it as a loosening and a person approves it first; a folder taken away, or a deny entry added,
 * narrows it and applies at once.
 *
 * A path is taken as the person wrote it — `~/work`, or absolute — and stored that way, so a configuration that moves to
 * another machine keeps meaning the same home. What it leads to on this disk, links followed, is what the jail checks a
 * file against, so the preview says so whenever the two differ: `~/link` that leads to `/` lets everything be attached,
 * and a preview that said only `~/link` would have hidden that.
 */
/** One entry of a list: as written, and where it leads on this disk. */
interface AttachEntry {
  /** As the configuration holds it — or, for the built-in list, as the jail reads it. */
  path: string;
  /** Where it leads on this disk, links followed; null for a pattern (`**∕.git/**`, `~/.*`), which names no one place. */
  real: string | null;
}
interface AttachReport {
  /** The folders files may be attached from. None: nothing can be attached. */
  roots: AttachEntry[];
  /**
   * Folders the configuration lists that name no place — relative, or on Windows without a drive — as written. They
   * allow nothing (see `namesItsPlace`), so they are shown apart from `roots`, with no place to lead to.
   */
  ignored: string[];
  /** The person's own entries that files may never come from, on top of the built-in list. */
  deny: AttachEntry[];
  /** What the jail never attaches from, whatever the configuration says: it cannot be removed. */
  builtIn: AttachEntry[];
}
//#endregion
//#region src/cli.d.ts
export declare function main(argv?: string[], env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, deps?: {
  /** Starts the stdio server. Injected so a test can inspect its inputs without opening stdio. */
  startMcp?: ((options: {
    core: ReturnType<typeof openCore>;
    env: NodeJS.ProcessEnv;
    platform: NodeJS.Platform;
  }) => Promise<void>) | undefined;
}): Promise<number>;
/** Exported for its test, which asks for Windows' quoting by name. */
export declare function renderAttach(report: AttachReport, platform?: NodeJS.Platform): string;
//#endregion