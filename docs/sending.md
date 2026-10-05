# Sending and approvals

An agent using this package cannot send mail without your approval. This page says how that is enforced, and what
it does not cover. It is about Gmail; Slack's gate — messages, files and reactions — is described in the
[`slack-posting` skill](../skills/slack-posting/SKILL.md) and in [What is where](architecture.md#how-a-slack-post-is-gated).
A Slack post's files come from the same folders as a Gmail draft's attachments: see
[the attachment rule](../skills/gmail-attachments/references/jail.md).

## Why it is in code

No Gmail scope separates drafting from sending. `gmail.compose` and `gmail.modify` both permit `drafts.send`, so
the permission you grant on the consent screen cannot express "may write, may not send". If the guarantee is going
to exist at all, it has to be enforced by the software.

That makes the honest claim narrow, and worth stating before the mechanism: **this package will not send without an
approval.** It is not a claim about your machine.

## The three steps

```
draft ──► send prepare ──► you read the preview ──► send execute ──► sent
             │                                          │
             │ records an approval bound to:            │ re-reads the draft and
             │   · a digest of what a recipient sees    │ refuses if either moved
             │   · the draft's Gmail message id         │
```

```bash
agent-gmail draft new --inbox acme/gmail --to sam@example.com --subject 'Tuesday' --text 'Works for me.'
agent-gmail send prepare --inbox acme/gmail --draft <draftId>     # prints the preview, sends nothing
agent-gmail send execute --inbox acme/gmail --draft <draftId> --approval <approvalId> --expect-to sam@example.com
```

**`prepare` sends nothing.** It reads the draft, refuses it outright if an agent could not have written it, and
records an approval. The preview it prints is the message as a recipient would receive it — decoded, so what you
read is what they read.

**`execute` re-reads the draft** and checks it against the record. The Gmail message id changes on every save, so
any edit after the preview voids the approval. The approval is single-use, claimed with an exclusive marker so two
processes cannot both spend it. It is never retried at any layer: a retried send may deliver twice and nothing here
could tell.

**You must pass what you believe you are sending.** `--expect-to` and friends are checked against the draft. If
they disagree, nothing is sent.

## Policies

Each mailbox has one. `agent-gmail inbox list` shows it.

| Policy | What it takes | When to use it |
|---|---|---|
| `chat` (default) | your yes in the conversation | an agent you are watching |
| `confirm` | a code typed at a terminal, or into a form from a client you chose to trust with approval forms | an agent you are not watching — with the change policy `confirm` too (`agentcomms policy confirm`) |
| `never` | nothing sends; the draft waits in Gmail | mailboxes an agent should never speak for |

Changing a policy to something weaker is a loosening, and a loosening is a change you approve: the command, or
`gmail_inbox_policy` from chat, shows you exactly what would change and does nothing until the approval it returns
is claimed. How that is approved is the mailbox's **change policy**. Under `chat`, the default, the agent claims it
after your yes in the conversation, and nothing can check that you said it. Under `confirm` it cannot be claimed
until you have typed the code at a terminal with the approve command the result gives.
`agent-gmail inbox policy <alias> --change confirm` sets it, and moving it back to `chat` is itself approved at a
terminal. Making a policy stricter needs nobody — `agent-gmail inbox policy <alias> --send confirm`, or the same
change from chat.

### Risk escalation

A `chat` send is raised to `confirm` on its own when the recipient looks like a mistake waiting to happen:

- an address that arrived in mail read this week and has never been written to before
- an attachment going to an external recipient for the first time
- a domain within two characters of one this mailbox writes to regularly

## Two guards under all of it

**One path.** Exactly one function calls Gmail's send endpoint. `test/send-path.test.mjs` fails the build if a
second appears.

**A guard beneath that.** The HTTP client refuses any request whose path ends `/send` without a one-shot permit
naming that draft, and refuses batch endpoints outright. A `messages.send` added anywhere in the package fails at
the request, not at review.

## What this does not protect you from

Stated plainly, because a security claim that overstates itself is worse than one that does not try.

- **An agent with a shell** can read your tokens, run this CLI, drive a pseudo-terminal, or call Gmail directly. No
  MCP server can stop that. `confirm` with a trusted client, or `never`, is the answer — with the change policy
  `confirm` too (`agentcomms policy confirm`), or the agent can move the mailbox back to `chat` on its own say-so.
- **An agent you do not watch, under the default `chat` change policy.** The software cannot tell your yes from an
  agent's, so such an agent can loosen a mailbox from `confirm` or `never` to `chat`, move credentials out of the
  keychain, or remove an account, each on its own claim — and every one of those is in the audit log. Set
  `agentcomms policy confirm` for an agent you are not watching.
- **Another Gmail MCP server** installed beside this one. Everything above assumes it owns the only route to
  Gmail's send endpoints. A second server with an ungated send tool does not break the guarantee so much as stand
  beside it — an agent simply uses the other one. `doctor` lists any it can find, in every client config it can
  read.
- **You approving without reading.** The preview exists to be read. A gate that is always waved through is worse
  than no gate, because it produces confidence rather than safety.
- **Mail already sent.** There is no recall. The 72-hour undo in Gmail's web client is a client-side delay, not an
  API.

## Approvals

Where Gmail is installed globally:

```bash
agent-gmail send list --inbox acme/gmail        # prepared, not yet used
agent-gmail send wait <approvalId>        # where one stands, now or once it changes: it only looks
agent-gmail send cancel <approvalId>      # void one
agent-gmail approve <approvalId>          # approve at this terminal, under `confirm`: the command the result gives
```

To approve, run the command the result gave you exactly as given: it names this installation's own Node and CLI
file, with its folders pinned, so it works without anything on your PATH and approves the very approval the agent
holds. On Windows with Node under `C:\Program Files` it comes as words to type, each quoted for your shell; where it
says the command is not locatable here, install or update that package the way you usually do and try again
([troubleshooting](troubleshooting.md#a-command-a-result-gave-you-is-not-found)).

An agent learns that a person approved by waiting, not by being told: `gmail_send_wait` (`agent-gmail send wait`),
`slack_approval_wait` (`agent-slack approval wait`), `resend_send_wait` (`agent-resend send wait`) and
`comms_approval_wait` (`agentcomms approval wait`) each say where an approval stands — 30 seconds by default, 300 at
most, and `--wait-seconds 0` for the status now — and never approve, claim or send.

Approvals expire. An approval left lying around is one somebody can still act on, so cancelling is never refused.
