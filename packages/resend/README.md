# @agentcomms/resend

Resend for coding agents. Read a team's domains, sent and received mail, metrics and suppressions — and send email
that **nothing sends without a person's approval of exactly what goes out**, once.

Not published yet: this package ships with the 0.7.0 release.

## What it promises, and who enforces it

**Read-only is enforced by this package, not by the key.** Resend has no read-only API key. A full-access key can
read, send, delete domains and create keys; `agent-resend` in `read` mode refuses to send, but the key itself would not
stop anything else that held it. A sending-only key can only send — Resend enforces that — and it cannot read
anything, so reads with it are reported as unavailable. `agent-resend doctor` says this on every run.

**Nothing is sent without a person.** A send is prepared, previewed — every recipient, BCC included, the reach
(unique recipients), the From domain and whether it is verified — and approved: a yes in the conversation under the
account's `chat` policy, or `agent-resend approve <id>` and a typed code under `confirm`. Above ten recipients a
person at a terminal approves, whatever the policy. The approval id is the request's `Idempotency-Key` and an
`agentcomms_approval` tag; a send whose outcome is unknown is never repeated, only checked.

**The key is typed by a person, at a terminal.** `agent-resend account add` reads it from a hidden prompt, or from
`RESEND_API_KEY` in that terminal, and stores it in the system keychain. No MCP tool accepts a key: a key typed into
a chat stays in the transcript.

**Received mail is untrusted.** Bodies, subjects, names and attachment names arrive inside the untrusted-content
envelope with hidden text removed and counted, beside Resend's own SPF, DKIM and DMARC results. Attachments are
listed, and downloaded only when asked, into the downloads folder.

**It stays out of the way of the team's own mail.** Resend's rate limit is shared by every key of a team, so this
package asks at most twice a second and stops on a 429 until Resend says it may ask again.

## Getting started

```sh
agent-resend account add acme/resend                 # a person types the key; read mode by default
agent-resend doctor
agent-resend domains --account acme/resend
agent-resend received list --account acme/resend
agent-resend account policy acme/resend --mode send  # a change a person approves
agent-resend send prepare --account acme/resend --from "Acme <hello@acme.test>" --to sam@partner.test \
  --subject "Hello" --text "Hi Sam"
agent-resend mcp                                     # the MCP server, for an agent
```

## Commands and tools

Every command has an MCP tool running the same operation, prefixed `resend_`, except `account add` (a key is typed
at a terminal), `approve` (under `confirm`, a person at a terminal) and `mcp` (it starts the server).
