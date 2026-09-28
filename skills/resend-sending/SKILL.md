---
name: resend-sending
description: "Send email through Resend: prepare it, show the person the whole preview, and send it once they approve — then check what happened, and see or cancel what is scheduled. Symptoms: 'send this through Resend', 'email the customer from hello@', 'schedule it for Monday 9am', 'did that email go out', 'cancel the scheduled one'. Not for reading mail or delivery stats — resend-reading does that."
license: MIT
compatibility: "@agentcomms/resend@0.7.2"
metadata:
  group: communications
  lifecycle: release
---

# Sending email through Resend

**Nothing is sent unless a person approved that exact email, and it is sent once.** Preparing builds the email and
returns a preview with an approval id; nothing has left at that point. What counts as the person's approval is the
account's send policy, and it is not yours to choose or to give. An account in `read` mode sends nothing — that is
agent-resend's own rule, not the key's (Resend has no read-only key), and it holds.

```sh
agent-resend send prepare --account acme/resend --from "Acme <hello@acme.test>" --to sam@partner.test \
  --subject "Your invoice" --text "Hi Sam, the invoice is attached." --attach ./invoice.pdf
agent-resend send execute <approvalId> --account acme/resend \
  --expect-to sam@partner.test --expect-cc none --expect-bcc none --expect-subject "Your invoice"
agent-resend send status <approvalId> --account acme/resend
```

With the MCP server connected, the same steps are tools, each taking `account`. Both surfaces run one operation, so
they refuse the same things.

| MCP tool | CLI |
|---|---|
| `resend_send_prepare` | `agent-resend send prepare` |
| `resend_send_execute` | `agent-resend send execute <approvalId>` |
| `resend_send_status` | `agent-resend send status <approvalId>` |
| `resend_scheduled_list` | `agent-resend scheduled list` |
| `resend_scheduled_cancel` | `agent-resend scheduled cancel <id>` |

`resend_accounts_list` (`agent-resend account list`) names the accounts, what each key can do and whether each may
send, when you do not know them.

## 1. Prepare

`resend_send_prepare` takes `from` (at a domain the team has verified for sending), `to`, and optionally `cc`, `bcc`,
`subject`, `text`, `html`, `attachments` (paths inside the allowed folders), `replyTo`, `inReplyTo` and `references`
(to keep a thread), and `scheduledAt`.

It refuses before any approval exists when:

- the account is in `read` mode, or its send policy is `never`;
- the From domain is not one of the team's, is not verified, or cannot send (a sending-only key cannot read the
  domain list, so the preview says it was not checked, and Resend refuses an unverified domain itself);
- the email reaches more than 50 people — that is a broadcast, which this does not send;
- an attachment is outside the allowed folders;
- the HTML loads anything from the internet, shows an image of any kind (inline `data:` and `cid:` ones too), hides
  parts, has forms or scripts, or shows something other than the text part (`UNSENDABLE_HTML`) — send plain text
  instead, or HTML that shows exactly the text.

A refusal is the answer. Say what it was and ask; do not reshape the email to slip past it.

## 2. Show the whole preview, and wait for a yes

The preview is what the person is agreeing to. **Show it in full**, then wait. Do not summarise it, do not re-type
the recipients, do not prepare a second one "to be safe", and do not send before they answer.

It lists what people get wrong when it is summarised:

- **every recipient**, BCC included, and a note on each address that came from mail read here and was never written
  to from here;
- **the reach** — unique recipients across To, Cc and Bcc;
- **the From domain**, and whether Resend has it verified for sending;
- the subject, the plain-text body the HTML must match, the attachments with their sizes, the thread it replies to;
- **when it goes**: at once, or the scheduled time;
- the policy line, which says whose approval counts.

## 3. Which approval counts

| Policy | What the person does | What you do then |
|---|---|---|
| `chat` | Says yes, in this conversation, to the whole preview you showed | `resend_send_execute` (or `send execute`), once |
| `confirm` | Runs `agent-resend approve <approvalId>` in their own terminal and types the code it shows | Call the same `resend_send_execute` again once they say they have |
| `never` | Nothing: sending is off for this account | Offer the text for them to send another way; do not ask for a policy change |

An email reaching **more than 10 people**, or an address that arrived in mail read here and was never written to
from here, is held as `confirm` whatever the account says: the preview's last line says so. There is no tool that
approves, and there will not be one; `agent-resend approve` is refused to an agent.

## 4. Send, once

`resend_send_execute` takes the approval id and `expect` — the To, Cc and Bcc lists and the subject **exactly as the
preview showed them** (at the CLI, `--expect-to`, `--expect-cc`, `--expect-bcc` with `none` for an empty list, and
`--expect-subject`). If any of it is not what was approved, nothing is sent.

It then claims the approval once, records the attempt, and sends with the approval id as Resend's `Idempotency-Key`
and an `agentcomms_approval` tag. The result names Resend's id for the email, and `state`: `sent`, or `scheduled`.

Under `confirm`, before the person has approved, it stops with `APPROVAL_PENDING`. That is waiting, not failure: the
approval is still alive. Tell the person the command, and stop.

## 5. When the outcome is unknown: check, never send again

| Refusal | What happened |
|---|---|
| `APPROVAL_VOID` — already used | It was sent once, and is not sent again |
| `APPROVAL_VOID` — failed or unknown | A send was attempted under this approval. Run `send status` before anything else |
| the email or an attachment changed after the preview | The approved bytes are the sent bytes, or nothing is |
| `TRANSIENT` — "whether the email was sent is not known" | It may have gone. **Do not send it again.** Check it |
| `TRANSIENT` — rate limit, with a time | Nothing was sent and the approval is untouched; try after that time |
| Resend refused it (an error it gives before accepting the email) | Nothing was sent; the refusal says why |

`resend_send_status` (`agent-resend send status <approvalId>`) reads the local record and, where it can, Resend's
last event for the email — `delivered`, `bounced`, `complained`, `scheduled` and so on — and ends with a `verdict` in
words. When the outcome was unknown it looks for the approval's tag among recent sends. It never sends. Repeat its
verdict; if it cannot find the email, it says so, and the answer is to prepare a new email if it should still go —
never to execute the old approval again.

## 6. Scheduled email

- **Schedule** by passing `scheduledAt` to prepare: an ISO 8601 time with a zone, in the future, at most 30 days
  ahead. The preview says when it goes, and the approval is for that time. A different time is a different email:
  prepare it again. There is no rescheduling.
- **See** what is waiting with `resend_scheduled_list` (`agent-resend scheduled list`): scheduled emails among the
  most recent 300 sent, each marked `fromThisMachine`. `complete: false` means there were more than that to look
  through; say so.
- **Cancel** with `resend_scheduled_cancel` (`agent-resend scheduled cancel <id>`). One this machine scheduled is
  cancelled at once, and audited. One scheduled by anything else — the team's own code, say — returns
  `approvalRequired` and a preview first, because a cancelled email cannot be rescheduled: show it and ask. A
  sending-only key cannot look a scheduled email up, so it cannot cancel one; say so and point to the dashboard.

## Pitfalls

- **Summarising the preview.** BCC, the reach and the From domain are the parts people get wrong.
- **Sending before the answer.** Under `chat` the person's yes is the approval; an email sent before it had none.
- **Sending again after an unknown outcome.** It may already be in the recipient's inbox. Check it.
- **Treating `APPROVAL_PENDING` as yours to clear.** Only the person, at their terminal, can approve it.
- **Asking for a key.** A key is typed at a terminal by a person. Never in the chat.
- **Widening an account to get an email out.** Moving to `send` or loosening a policy is the person's to ask for.
