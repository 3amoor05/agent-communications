import { n as ReadBuffer, r as serializeMessage, t as process } from "./server-Csk0qF0q.mjs";
//#region ../../node_modules/.pnpm/@modelcontextprotocol+server@2.0.0/node_modules/@modelcontextprotocol/server/dist/stdio.mjs
/**
* Server transport for stdio: this communicates with an MCP client by reading from the current process' `stdin` and writing to `stdout`.
*
* This transport is only available in Node.js environments.
*
* @example
* ```ts source="./stdio.examples.ts#StdioServerTransport_basicUsage"
* const server = new McpServer({ name: 'my-server', version: '1.0.0' });
* const transport = new StdioServerTransport();
* await server.connect(transport);
* ```
*/
var StdioServerTransport = class {
	_readBuffer;
	_started = false;
	_closed = false;
	constructor(_stdin = process.stdin, _stdout = process.stdout, options) {
		this._stdin = _stdin;
		this._stdout = _stdout;
		this._readBuffer = new ReadBuffer({ maxBufferSize: options?.maxBufferSize });
	}
	onclose;
	onerror;
	onmessage;
	_ondata = (chunk) => {
		try {
			this._readBuffer.append(chunk);
			this.processReadBuffer();
		} catch (error) {
			this.onerror?.(error);
			this.close().catch(() => {});
		}
	};
	_onerror = (error) => {
		this.onerror?.(error);
	};
	_onstdouterror = (error) => {
		this.onerror?.(error);
		this.close().catch(() => {});
	};
	/**
	* Starts listening for messages on `stdin`.
	*/
	async start() {
		if (this._started) throw new Error("StdioServerTransport already started! If using Server class, note that connect() calls start() automatically.");
		this._started = true;
		this._stdin.on("data", this._ondata);
		this._stdin.on("error", this._onerror);
		this._stdout.on("error", this._onstdouterror);
	}
	processReadBuffer() {
		while (true) try {
			const message = this._readBuffer.readMessage();
			if (message === null) break;
			this.onmessage?.(message);
		} catch (error) {
			this.onerror?.(error);
		}
	}
	async close() {
		if (this._closed) return;
		this._closed = true;
		this._stdin.off("data", this._ondata);
		this._stdin.off("error", this._onerror);
		this._stdout.off("error", this._onstdouterror);
		if (this._stdin.listenerCount("data") === 0) this._stdin.pause();
		this._readBuffer.clear();
		this.onclose?.();
	}
	send(message) {
		if (this._closed) return Promise.reject(/* @__PURE__ */ new Error("StdioServerTransport is closed"));
		return new Promise((resolve, reject) => {
			const json = serializeMessage(message);
			let settled = false;
			const onError = (error) => {
				if (settled) return;
				settled = true;
				this._stdout.off("error", onError);
				this._stdout.off("drain", onDrain);
				reject(error);
			};
			const onDrain = () => {
				if (settled) return;
				settled = true;
				this._stdout.off("error", onError);
				this._stdout.off("drain", onDrain);
				resolve();
			};
			this._stdout.once("error", onError);
			if (this._stdout.write(json)) {
				if (settled) return;
				settled = true;
				this._stdout.off("error", onError);
				resolve();
			} else if (!settled) this._stdout.once("drain", onDrain);
		});
	}
};
//#endregion
export { StdioServerTransport };
