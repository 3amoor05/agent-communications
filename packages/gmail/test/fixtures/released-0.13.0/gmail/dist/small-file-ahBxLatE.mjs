import { lstat, open } from "node:fs/promises";
import { constants as constants$1 } from "node:fs";
//#region src/operations/small-file.ts
/**
* Reading a file somebody else chose the name of.
*
* Two places here read a client JSON off disk: the scanner that lists what is sitting in the download directory,
* and `client add`, which reads the one path a person typed. Both were `readFile` on a path, and `readFile` on a
* path will read whatever is at the end of it — a FIFO that blocks until a writer appears, a device that never
* ends, a directory, or a symlink pointing at something else entirely. A download directory is a place other
* software writes to, so "a file matching `client_secret*.json`" is not a thing this process chose.
*
* So both go through one bounded read instead. It opens once and answers from that handle, which also closes the
* gap between `stat(path)` and `readFile(path)` — two lookups that can land on two different files, and the file
* in question is a client secret.
*/
/** A real client JSON is a few hundred bytes. This is generous, and it is what stops `/dev/zero` being read. */
const MAX_CLIENT_BYTES = 65536;
/** One bounded read: open once, check the shape, check the size, then take the text off the same handle. */
async function readSmallFile(path, options) {
	const maxBytes = options.maxBytes ?? 65536;
	const flags = constants$1.O_RDONLY | (options.follow ? 0 : constants$1.O_NOFOLLOW ?? 0) | (constants$1.O_NONBLOCK ?? 0);
	if (!options.follow) try {
		if ((await lstat(path)).isSymbolicLink()) return {
			ok: false,
			problem: "missing"
		};
	} catch {
		return {
			ok: false,
			problem: "missing"
		};
	}
	let handle;
	try {
		handle = await open(path, flags);
	} catch {
		return {
			ok: false,
			problem: "missing"
		};
	}
	try {
		const info = await handle.stat();
		if (!info.isFile()) return {
			ok: false,
			problem: "not-a-file"
		};
		if (info.size > maxBytes) return {
			ok: false,
			problem: "too-large",
			modifiedAt: info.mtime,
			modifiedMs: info.mtimeMs
		};
		const buffer = Buffer.allocUnsafe(maxBytes + 1);
		const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
		if (bytesRead > maxBytes) return {
			ok: false,
			problem: "too-large",
			modifiedAt: info.mtime,
			modifiedMs: info.mtimeMs
		};
		return {
			ok: true,
			text: buffer.subarray(0, bytesRead).toString("utf8"),
			modifiedAt: info.mtime,
			modifiedMs: info.mtimeMs
		};
	} catch {
		return {
			ok: false,
			problem: "missing"
		};
	} finally {
		await handle.close();
	}
}
/**
* The same ceiling, for a stream.
*
* `--file` and `--from <path>` are bounded; the pipes that do the same job were not, and a pipe is the easier of
* the two to point at something endless — `cat /dev/zero | agent-gmail draft create` accumulates until the process
* dies. The limit has to be enforced while reading rather than after, which is the whole difference.
*
* It stops at the first chunk that takes the total past the limit, so it never holds more than `maxBytes` plus one
* chunk, and it stops reading rather than draining: whatever is still upstream is the caller's problem, not this
* process's memory.
*
* A stream that faults mid-read is an outcome like the others rather than a throw. `for await` turns the stream's
* `error` event into a rejection, which left the two callers reporting a broken pipe as `UNEXPECTED` — the code
* this package uses for "something happened that we did not think about", which a closed pipe is not.
*/
async function readBoundedStream(stream, maxBytes) {
	const chunks = [];
	let total = 0;
	try {
		for await (const chunk of stream) {
			const buffer = Buffer.from(chunk);
			total += buffer.byteLength;
			if (total > maxBytes) return {
				ok: false,
				problem: "too-large"
			};
			chunks.push(buffer);
		}
	} catch {
		return {
			ok: false,
			problem: "unreadable"
		};
	}
	return {
		ok: true,
		text: Buffer.concat(chunks).toString("utf8")
	};
}
//#endregion
export { readBoundedStream as n, readSmallFile as r, MAX_CLIENT_BYTES as t };
