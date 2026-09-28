import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Slack's Web API and its files host on a loopback port. Never the real ones.
 *
 * A real HTTP server rather than a function standing in for `fetch`, because what these tests have to show is about
 * the request as it leaves: which token rode on it, in which header, and that nothing else did. The guard is not
 * relaxed to reach it — `fetch` below is the *inner* fetch, which only ever sees a URL the guard has already
 * approved, as `https://slack.com/api/…` or `https://files.slack.com/files-pri/…`, and rewrites the origin to this
 * server after that approval. Any other URL reaching it means the guard let it through, and it throws rather than
 * sending — so a token cannot reach a third host through this fake, and a test that tried would fail.
 *
 * One server for both hosts, told apart by a prefix the rewrite adds: `/api/…` is the Web API, `/files/…` the files
 * host. Anything else that arrives — a redirect somebody followed, say — is recorded as `other`, so a test can say
 * nothing did.
 */

export const API = 'https://slack.com/api/';
export const FILES = 'https://files.slack.com/files-pri/';

export interface SlackRequest {
  /** Which host it reached: the Web API, the files host, or neither — which is always a failure. */
  readonly host: 'api' | 'files' | 'other';
  /** The Slack method, from the last path segment: `apps.manifest.validate`. Empty for anything but the Web API. */
  readonly method: string;
  /** The HTTP verb. */
  readonly verb: string;
  /** The path as the real host would have seen it, without this server's prefix and without the query. */
  readonly path: string;
  readonly authorization: string | undefined;
  readonly contentType: string | undefined;
  readonly params: URLSearchParams;
  /** The path and query exactly as received. */
  readonly url: string;
  /** Everything that arrived — request line, every header, the body — for "it appeared nowhere else" assertions. */
  readonly raw: string;
}

export type Reply = (request: SlackRequest) => unknown;

/** How the files host answers one file. */
export interface FileReply {
  /** 200 unless said otherwise. */
  status?: number;
  /** Sent as given, after the defaults: a `content-length` here overrides the true one. */
  headers?: Record<string, string>;
  /** Sent in one piece, with its length declared. */
  body?: Uint8Array | string;
  /** Sent one after another with no length declared, so only a running count can tell how much is coming. */
  chunks?: readonly Uint8Array[];
  /** Send the headers and one byte, then nothing more: the case a timeout exists for. */
  stall?: boolean;
  /** Destroy the socket instead of answering. */
  drop?: boolean;
}

export type FileAnswer = (request: SlackRequest) => FileReply;

export interface FakeSlack {
  readonly requests: SlackRequest[];
  /** Replies by method. A method with no reply answers `unknown_method`, as Slack does. */
  script: Record<string, Reply>;
  /** Answers by `<TEAM>-<FILEID>`, the pair the files path names. A file with no answer is a 404. */
  files: Record<string, FileAnswer>;
  /** This server's own origin, for a reply that must point somewhere the guard never approved — a redirect. */
  readonly local: string;
  /** The inner fetch to hand the CLI. */
  readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  close(): Promise<void>;
}

function read(request: IncomingMessage): Promise<string> {
  return new Promise((settle, fail) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => settle(body));
    request.on('error', fail);
  });
}

function answerFile(fake: FakeSlack, recorded: SlackRequest, response: ServerResponse): void {
  const pair = recorded.path.split('/')[2] ?? '';
  const answer = fake.files[pair];
  const reply: FileReply = answer ? answer(recorded) : { status: 404, body: 'file_not_found' };
  if (reply.drop) {
    response.socket?.destroy();
    return;
  }
  const status = reply.status ?? 200;
  const headers = { 'content-type': 'application/octet-stream', ...reply.headers };
  if (reply.stall) {
    response.writeHead(status, headers);
    response.write(Buffer.from([0]));
    return;
  }
  if (reply.chunks) {
    response.writeHead(status, headers);
    for (const chunk of reply.chunks) response.write(chunk);
    response.end();
    return;
  }
  const body = typeof reply.body === 'string' ? Buffer.from(reply.body) : Buffer.from(reply.body ?? new Uint8Array());
  response.writeHead(status, { 'content-length': String(body.byteLength), ...headers });
  response.end(body);
}

export async function startFakeSlack(script: Record<string, Reply> = {}): Promise<FakeSlack> {
  const requests: SlackRequest[] = [];
  const fake: FakeSlack = {
    requests,
    script,
    files: {},
    local: '',
    fetch: async () => {
      throw new Error('not started');
    },
    close: async () => undefined,
  };

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const body = await read(request);
      const url = request.url ?? '';
      const pathname = url.split('?')[0] ?? '';
      const host = pathname.startsWith('/api/') ? 'api' : pathname.startsWith('/files/') ? 'files' : 'other';
      const method = host === 'api' ? (pathname.split('/api/')[1] ?? '') : '';
      const headers: string[] = [];
      for (let i = 0; i < request.rawHeaders.length; i += 2) {
        headers.push(`${request.rawHeaders[i]}: ${request.rawHeaders[i + 1]}`);
      }
      const recorded: SlackRequest = {
        host,
        method,
        verb: request.method ?? '',
        path: host === 'files' ? pathname.slice('/files'.length) : pathname,
        authorization: request.headers.authorization,
        contentType: request.headers['content-type'],
        params: new URLSearchParams(body),
        url,
        raw: `${request.method} ${url}\n${headers.join('\n')}\n\n${body}`,
      };
      requests.push(recorded);
      if (host === 'files') {
        answerFile(fake, recorded, response);
        return;
      }
      if (host === 'other') {
        // Answered as if it were the file, so a redirect that was followed looks like a success to the client — and
        // only this record says otherwise.
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.end('followed');
        return;
      }
      const reply = fake.script[method];
      const answer = reply ? reply(recorded) : { ok: false, error: 'unknown_method' };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(answer));
    })();
  });
  await new Promise<void>((settle) => server.listen(0, '127.0.0.1', () => settle()));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  return Object.assign(fake, {
    local: origin,
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      // Only ever a URL the guard has approved. Anything else here means the guard let it through, which is a failure.
      if (url.startsWith(API)) return fetch(url.replace('https://slack.com', origin), init);
      if (url.startsWith(FILES)) return fetch(url.replace('https://files.slack.com', `${origin}/files`), init);
      throw new Error(`the guard let ${url} through`);
    },
    close: () =>
      new Promise<void>((settle) => {
        server.closeAllConnections();
        server.close(() => settle());
      }),
  });
}
