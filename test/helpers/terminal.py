"""A command run on a pseudo-terminal, as a person runs it at their own terminal (CUE-403).

`approve` is a person's command: it refuses anything whose input and output are not a terminal, and asks for a code
the approval store issued. A test that pastes a printed approval into a real shell has to give it one, so this runs
the shell on a pseudo-terminal and, when the command asks for its code ("Type ABCD to approve this change"), types the
code back, as the person reading the screen would. Everything the command writes is copied to stdout; the exit code is
the command's.

    python3 terminal.py challenge /bin/sh -c '<the printed line>'
    python3 terminal.py enter /bin/sh -c '<the printed line>'     # presses Enter at the prompt: cancels

POSIX only (Python's `pty`); test/helpers/real-shell.mjs skips where it is missing. Nothing here reads the code from
anywhere but the screen.
"""

import os
import pty
import re
import sys

ASKED = re.compile(rb"Type (\S+) to ")


def main() -> int:
    answer = sys.argv[1]
    argv = sys.argv[2:]
    pid, fd = pty.fork()
    if pid == 0:
        os.execv(argv[0], argv)
    seen = b""
    answered = False
    while True:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            # The other end closed: the command has exited.
            break
        if not chunk:
            break
        seen += chunk
        sys.stdout.buffer.write(chunk)
        sys.stdout.flush()
        if not answered:
            asked = ASKED.search(seen)
            if asked:
                answered = True
                os.write(fd, (asked.group(1) if answer == "challenge" else b"") + b"\r")
    _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status)


if __name__ == "__main__":
    sys.exit(main())
