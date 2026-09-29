# The attachment jail

Every local path handed to `attach` on a draft passes through one function, `checkAttachable`, before a single
byte is read. This file is what that function does, rule by rule, in the order it applies them, with the reason
each rule exists and the one thing that would make a refused file attachable. Open it when an attach was
refused and you are about to tell the user why, or when you are tempted to work around a refusal.

The short version: a file may be attached only if it resolves — after `~` expansion and after every symlink is
followed — to a **regular file**, **inside one of the allowed roots**, and **inside none of the deny entries**.
Resolution happens first so that a link cannot launder a path. A refusal is a correct answer about that file.
Copying, moving or renaming it so that it passes is the same act with a step in front of it.

## The order of the checks

The order matters, because it decides which error the user sees.

| Step | What happens | The failure it produces |
|---|---|---|
| 1 | A leading `~` is expanded against the process's home, then the path is resolved to an absolute one. Nothing else is expanded — no `$HOME`, no globs, no `..` cleverness beyond what path resolution does. | — |
| 2 | `realpath` follows every symlink in the path. | `NOT_FOUND`: `attachment not found: <path>` (CLI exit 66) |
| 3 | The real path is `stat`ed and must be a regular file. | `BAD_DATA`: `not a regular file: <path>` (CLI exit 65) |
| 4 | Each allowed root is expanded and resolved, and the real path must be inside at least one of them. | `BAD_DATA`: `attachments must come from an allowed folder; <path> is outside them` |
| 5 | Each deny entry is tested in order — the built-in ones first, then anything in `defaults.attachDeny`. The first match refuses. | `BAD_DATA`, with a message naming the rule that matched |
| 6 | The real path is returned, and the name that goes on the wire is that file's own basename. | — |

Two consequences worth holding on to. The path the user typed is never what is attached: the resolved real
path is, and the filename on the message is that file's basename, not a name an agent chose. And because the
check happens before the read, a refusal means the bytes were never opened.

## The defaults

The allowed roots default to `~` — the whole of the user's home directory and nothing else.

The deny entries default to five, plus two more on Windows:

| Entry | How it is matched | What it covers |
|---|---|---|
| the tool's own configuration directory | as a path: anything at or inside it | `config.json`, which describes every connected mailbox, its policies and its scopes |
| `~/.*` | the **first** path segment under home begins with a dot | `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config`, `~/.npmrc`, shell history, agent configuration |
| `~/Library` | as a path: anything at or inside it | on macOS: mail stores, keychains, browser profiles, application tokens |
| `**/.git/**` | any path segment equal to `.git`, case-insensitively | repository internals: remote URLs that sometimes carry tokens, and the full object history |
| `**/.env*` | the **basename** begins with `.env` | `.env`, `.env.local`, `.env.production`, anywhere on disk |
| `%APPDATA%` | as a path, when the variable is set | the Windows roaming profile |
| `%LOCALAPPDATA%` | as a path, when the variable is set | the Windows local profile |

Anything in `defaults.attachDeny` is appended to that list and matched by the same three shapes: an entry
starting with `**/` matches by basename (with a trailing `*` meaning prefix), `**/.git/**` is special-cased to
match by segment, and anything else is treated as a directory path.

## The rules, one at a time

### Outside every allowed root

The roots are the whole of what this machine will let leave as mail. A file outside them was never offered,
and the check cannot tell a deliberate path from a mistaken one. The refusal carries a hint about widening
`defaults.attachRoots`; see *Changing the policy* below before repeating it, because the hint names a route
that does not exist as a command.

**Instead:** ask the user to move or copy the file under an allowed folder themselves, knowingly, or to widen
the roots themselves. Do not offer to do either for them.

### A dot-entry directly under home

`~/.ssh`, `~/.aws`, `~/.config`, `~/.gnupg`, `~/.npmrc`: one attached private key is a compromised account,
and one attached cloud credentials file is a compromised estate. The rule is deliberately crude — first
segment, starts with a dot — because the value of a rule like this is that it has no exceptions to argue
about.

Note the limit of the rule as written: it tests only the first segment under home. A dot-directory deeper in
the tree, say a `.secrets` folder inside a project, is not caught by this entry. That is not licence to go
looking for one; it is a reason to treat the deny list as a floor rather than a guarantee, and to attach only
what the user actually named.

**Instead:** ask what the user meant to send. A public key, a sample configuration or a redacted copy is
something they can put somewhere ordinary, on purpose.

### `~/Library` on macOS

Mail stores, keychains, browser profiles, application support directories. Nothing a person means to email
lives only here. It is denied as a path, so everything beneath it is denied too.

**Instead:** find the user's own copy of the document elsewhere, or ask them to export one.

### Any `.git` segment

A repository's git directory holds the remote URLs — which sometimes carry tokens — and the object history of
everything ever committed, including whatever was committed and then removed. The match is on any segment
equal to `.git`, so a path deep inside a repository is refused as surely as the directory itself.

**Instead:** attach the working-tree file, or an archive the user produced deliberately.

### A file whose name begins with `.env`

Dotenv files are secrets by convention, and the convention is exactly what makes them findable by anyone
asking an agent to "attach the config". The match is on the basename, so `.env`, `.env.local` and
`.env.production` are refused wherever they sit — and a file called `.environment-notes` is refused too,
because a prefix rule cannot tell them apart.

**Instead:** ask the user to name the specific values they want to share, or to redact a copy themselves.

### The tool's own configuration directory

`config.json` describes every connected mailbox: aliases, addresses, granted scopes, send policies, internal
domains. Sending it is handing over the map of the user's mail estate.

**Instead:** `agent-gmail doctor` reports what is configured and what works without printing secrets. That is
the right artefact when somebody asks the user to describe their setup.

### A symlink that lands somewhere denied

Resolution happens before the decision precisely so that a link cannot be used as a laundering step. A symlink
in the user's Documents folder pointing at `~/.ssh/id_rsa` is refused with the dot-folder message, naming the
real location, because the real location is what the check saw.

**Instead:** attach the real file, if the real file is allowed.

### Anything that is not a regular file

A directory, a socket, a device, a named pipe. The wire carries the bytes of one file, so this is a shape
error rather than a permission one, and the message says so: `not a regular file`.

**Instead:** ask the user for an archive they made, or attach the files individually.

### A path that does not exist

`realpath` fails and the answer is `NOT_FOUND`. A typo and a deliberately misleading path are
indistinguishable from here, which is why nothing tries to find a near-match on disk.

**Instead:** confirm the path with the user. Do not search their disk for something similar.

### The roots themselves

A root is allowed, including the root directory itself: `isInside` treats a path equal to the root as inside
it. So `~` being a root means any ordinary file in the home tree passes step 4, and the deny entries are what
carve the dangerous parts back out. This is why the deny list, not the root list, is where the safety lives —
and why shortening it is treated as a loosening.

One environment caveat, because it produces refusals that look wrong. The policy's `home` is `HOME`, or
`USERPROFILE` where that is unset — Windows sets only the second — or, failing both, the home directory of the
account the process runs as. It is never empty, so `~` never quietly resolves to the working directory. What
it resolves to is *that process's* home, which is not always the home the user has in mind: a server started
by a launch agent, a container, or a different account carries that account's `HOME`, and the `~` root and the
`~/.*` rule are anchored to it. The out-of-roots message quotes the path you passed, not the home it was
compared against, so it will not show you this. If a file plainly inside the user's own home is refused as
outside every root, the environment the process inherited is the thing to check before assuming the file is
the problem.

## The other direction: where downloads land

Attaching is one direction. The other — attachment downloads — has no root at all any more, because where a
stranger's file lands is the person's to say. A download asks first (`destinationRequired: true`, with a question and
a `choiceId`), and saves only into the folder the person answered with:

- `downloads` — their Downloads folder: `defaults.downloadsDir` when they set one, else the one their system keeps
  (the XDG one on Linux, the Downloads known folder on Windows), else `<home>/Downloads`;
- `current` — the folder the server or the command was started in;
- a folder they name, absolute or starting with `~`. A relative one is refused with `USAGE` before the question is
  spent; one that is missing is made (`0700`); one that is a file, or one nothing can be written in, is refused with
  `BAD_DATA`, still before the question is spent.

It has a deny list of its own, the counterpart of the one above, checked whoever answered, on the path as written and
after links are followed: this package's own configuration, state (approvals, the audit log, download records), data
and credential folders; any hidden folder anywhere, at any depth — `~/.ssh`, `~/.config`, a project's `.git`,
`.github`, `.husky`, `.vscode` or `.claude`, on any disk — except a checkout under `.claude/worktrees/<name>`, inside
which a hidden folder is refused again; `node_modules`, `site-packages`, `dist-packages` and `__pycache__` wherever
they are, and any folder inside a Python virtual environment (a `pyvenv.cfg` in it or above it) or a Python
installation (`conda-meta`, `Lib/os.py` or `lib/python3.<minor>/os.py` in it or above it — `~/miniconda3`,
`C:\Python312` — though the home and a disk's root are never taken for one); `~/Library`; on
Windows the profile's `AppData`, `%APPDATA%`, `%LOCALAPPDATA%`, `%PROGRAMDATA%`, the Windows folder, Program Files,
PowerShell's profile folders (`Documents\PowerShell`, `Documents\WindowsPowerShell`, in the profile's Documents and
wherever the registry says Documents is), a drive's root, a network share, a device path and a path with no drive; on
Linux the same Windows folders reached through WSL on a Windows drive, wherever it is mounted (`/mnt/<letter>` by default) — the drive itself, `Windows`, `Program Files`,
`ProgramData`, a profile's `AppData`, PowerShell's profile folders — in any case; and
the system's folders — `/`, `/etc`, `/usr`, `/bin`, `/sbin`, `/lib`, `/var` (but not macOS's per-user temporary folder
in it), `/opt`, `/root`, `/System`, `/Library`, `/Applications`, `/private/etc`, `/private/var` — except a home inside
one, such as `/root` or `/var/lib/<name>`. The home itself is allowed. A folder on the list is refused with
`BAD_DATA`, and a default folder on it — a server started in a hidden folder — is shown in the question as
unavailable, with the reason, rather than offered.

Whatever folder it lands in, a file keeps its extension only when that is one a viewer opens and no program is known
to run or load by its name — see `risk-flags.md`, `saved-as-download` — and anything else is saved with `.download`
after its whole name. That stops a program that goes by a file's extension or a name it knows; it does not stop one
that loads every file in a folder whatever it is called — a zsh completions folder, an application's plugin or startup
folder. Those are any folder a program was told to use, so the list above cannot hold them all, and saving into one
is the person's choice. Every saved file is marked as downloaded from the internet, the moment it is made and before
its bytes are written: the `com.apple.quarantine` attribute on macOS, a `Zone.Identifier` stream on Windows — none
under Linux, WSL writing to a Windows drive included.

Under the mailbox's `confirm` change policy the answer has to come from the person where an agent cannot give it — at
their own terminal (`agent-gmail approve <choiceId>`) or in a trusted client's form — and a `saveTo` in the arguments
is refused with `APPROVAL_PENDING`.

The folder is resolved through its links — the person named it, so a link in it goes where they meant. What is
never followed is anything at a file's own name inside it: each file is created with `O_EXCL` and no-follow, so a
planted symlink, or a file already there, makes the new one `-2` rather than being written through or over. Once
each file is made, the folder is looked at again without following links, and has to be the folder that was opened
and checked — the same disk and inode — or the file is removed and the download stops. The question is bound to the
mailbox, the messages and parts, the files it listed and the names it showed them under; a claim for anything else is
refused, and the question left open until it expires, thirty minutes after it was asked.

Exports still land under the downloads root, `<root>/<organisation>/<platform>/<out>`, with `out` held to a relative,
`..`-free subpath and the real path proved inside the root — that is `gmail-export`'s, and its reference says how.

## Changing the policy

Both lists live in `config.json` under `defaults`: `attachRoots` (default `["~"]`) and `attachDeny` (default
empty, appended to the built-ins above). The configuration layer classifies **adding a root** and **removing a
deny entry** as loosening a safety setting: a write that does either is refused with `LOOSENING_REFUSED`
(CLI exit 10) unless it carries a consent proof produced by a person at an interactive terminal.

Two things follow, and both matter when you report a refusal:

- **No command in this package edits either list.** The hint attached to the out-of-roots error suggests
  adding the folder to `defaults.attachRoots` "with the CLI", and there is no such CLI command. In practice
  the user edits `config.json` themselves. Report the refusal and the setting; do not invent the command.
- **Never propose widening.** Not as a workaround, not as a suggestion, not as a "you could always". The
  refusal is the finding. What to do about it belongs to the user.

## Reporting a refusal

Three sentences is usually the whole of it: which file, which rule, and the one thing that would change it.

```text
`~/.ssh/id_rsa` was refused: files under a dot-folder in your home are never attached, because that is
where SSH keys and cloud credentials live. Nothing was read. If you meant to send a public key, copy the
one you want somewhere ordinary and tell me the path.
```

What not to write: anything that treats the rule as an obstacle. Copying the file to the Desktop, renaming it,
zipping it, base64-ing it into the body, or reading it and pasting the contents are all the same failure — the
rule is about the file, not about its location or its wrapper.

## Where else to look

- `references/risk-flags.md` — the inbound half: what a downloaded file's flags mean.
- `references/contract.md` — the shared contract, including why downloads have one root at all.
