import {
  activeGeneration,
  type ClientConfig,
  type CliHandoffs,
  CommsError,
  type Config,
  generationState,
  handoffSentence,
  managingOrganisation,
  type OrganisationGeneration,
  organisationsOf,
  parseName,
  requireLiveOrganisationGeneration,
  shownText,
} from '@agentcomms/core';
import { clientOptionHint, handoffClause } from '../handoffs.ts';

/** The client decision recorded in a new-inbox consent flow (design 2026-10-02 §D6). */
export interface GmailClientChoice {
  name: string;
  clientId: string;
  organisation?: string | undefined;
  organisationLabel?: string | undefined;
  generation?: OrganisationGeneration | undefined;
  /** Whether this route depended on the generation still being the organisation's active one. */
  activeGeneration?: boolean | undefined;
  /** Whether this route depended on the organisation still offering its client for other addresses. */
  forOtherAddresses?: boolean | undefined;
}

export interface GmailClientChoiceOptions {
  alias: string;
  email?: string | undefined;
  client?: string | undefined;
  /** Setup can make a client when no existing one is eligible; inbox add must refuse instead. */
  allowOwnClient?: boolean | undefined;
  /** The commands a refusal names (`GmailContext.handoffs`): located, for the shell of the output. */
  handoffs: CliHandoffs;
}

function generationForLiveRow(
  config: Config,
  name: string,
  row: ClientConfig | undefined = config.clients[name],
): { organisation: string; label: string; generation: OrganisationGeneration } | undefined {
  if (!row) return undefined;
  for (const [organisation, record] of Object.entries(organisationsOf(config)).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const generation = record.gmail?.generations.find((candidate) => candidate.name === name);
    if (!generation || generation.clientId !== row.clientId) continue;
    // A canonical owned row whose marker disappeared is unreconciled drift, whether the generation is active or
    // retained. Keep it associated long enough for the live-generation validator to refuse it with `org update`;
    // otherwise it silently becomes an ordinary client and bypasses `serves` and `forOtherAddresses`. Rows D8(c)/(e)
    // deliberately unmarked during reconciliation are `name-reused`/`altered`, not `unmarked`, and remain ordinary.
    const ownedWithoutMarker =
      generation.ownership === 'owned' && generationState(config, organisation, generation) === 'unmarked';
    if (generation.ownership === 'owned' && row.organisation !== organisation && !ownedWithoutMarker) continue;
    if (generation.ownership === 'adopted' && row.organisation && row.organisation !== organisation) continue;
    return { organisation, label: record.label, generation };
  }
  return undefined;
}

/** The organisation whose owned or adopted generation names this live client row, if there is one. */
export function organisationForClient(config: Config, name: string): string | undefined {
  const row = config.clients[name];
  return generationForLiveRow(config, name, row)?.organisation;
}

function isAssociated(config: Config, name: string, row: ClientConfig): boolean {
  if (managingOrganisation(config, row) !== null) return true;
  return generationForLiveRow(config, name, row) !== undefined;
}

/** Whether an address is one this generation says its Google client serves. */
export function generationServes(generation: OrganisationGeneration, email: string): boolean {
  if (generation.serves === 'any') return true;
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return generation.serves.domains.includes(domain);
}

function refuseOutsideDomains(
  organisation: string,
  generation: OrganisationGeneration,
  email: string | undefined,
  handoffs: CliHandoffs,
): void {
  if (email === undefined || generationServes(generation, email)) return;
  throw new CommsError(
    'CONFIG',
    `the organisation ${organisation} says its Google client "${generation.name}" does not serve ${email}`,
    {
      hint: clientOptionHint(handoffs, 'Choose a client that serves this address'),
      details: { organisation, client: generation.name },
    },
  );
}

function organisationChoice(
  config: Config,
  organisation: string,
  label: string,
  generation: OrganisationGeneration,
  email: string | undefined,
  active: boolean,
  forOtherAddresses: boolean,
  handoffs: CliHandoffs,
): GmailClientChoice {
  const row = requireLiveOrganisationGeneration(config, organisation, generation, handoffs);
  refuseOutsideDomains(organisation, generation, email, handoffs);
  return {
    name: generation.name,
    clientId: row.clientId,
    organisation,
    organisationLabel: shownText(label, 64),
    generation,
    activeGeneration: active,
    forOtherAddresses,
  };
}

/**
 * Chooses a client before a new-mailbox consent link is built, in the exact order of design 2026-10-02 §D6.
 * Import never calls this function: an imported refresh token remains bound to the client it arrived with.
 */
export function chooseClientForNewInbox(config: Config, options: GmailClientChoiceOptions): GmailClientChoice | null {
  const { handoffs } = options;
  if (options.client !== undefined) {
    const row = config.clients[options.client];
    const managed = generationForLiveRow(config, options.client, row);
    if (managed) {
      return organisationChoice(
        config,
        managed.organisation,
        managed.label,
        managed.generation,
        options.email,
        false,
        false,
        handoffs,
      );
    }
    if (!row) {
      throw new CommsError('CONFIG', `no OAuth client called "${options.client}" is registered`, {
        hint: handoffSentence(
          handoffs.own(['client', 'add', '--help'], { uses: [] }),
          (command) => `Register one as described by ${command}.`,
        ),
      });
    }
    if (row.provider !== 'gmail') {
      throw new CommsError('CONFIG', `"${options.client}" is not a Google OAuth client`, {
        hint: handoffSentence(handoffs.own(['client', 'list']), (command) => `Choose a client listed by ${command}.`),
      });
    }
    const markedFor = managingOrganisation(config, row);
    if (markedFor !== null) {
      throw new CommsError(
        'CONFIG',
        `the OAuth client "${options.client}" is marked for organisation ${markedFor}, but no matching live generation claims it`,
        {
          hint: handoffSentence(
            handoffs.core(['org', 'update', markedFor]),
            (command) => `Run ${command} (or comms_org_update from a chat) before signing in through it.`,
            { instead: `Call comms_org_update for ${markedFor} from a chat before signing in through it.` },
          ),
        },
      );
    }
    return {
      name: options.client,
      clientId: row.clientId,
    };
  }

  const parsed = parseName(options.alias);
  if (parsed) {
    const record = organisationsOf(config)[parsed.org];
    const active = activeGeneration(record);
    if (record && active)
      return organisationChoice(config, parsed.org, record.label, active, options.email, true, false, handoffs);
  }

  const optedIn = Object.entries(organisationsOf(config))
    .map(([organisation, record]) => ({ organisation, record, generation: activeGeneration(record) }))
    .filter(
      (
        candidate,
      ): candidate is {
        organisation: string;
        record: (typeof candidate)['record'];
        generation: OrganisationGeneration;
      } => candidate.record.forOtherAddresses && candidate.generation !== undefined,
    )
    .sort((left, right) => left.organisation.localeCompare(right.organisation));
  if (optedIn.length > 1) {
    throw new CommsError(
      'CONFIG',
      `more than one organisation offers its Google client for other addresses: ${optedIn.map((item) => item.organisation).join(', ')}`,
      {
        hint: clientOptionHint(handoffs, 'Choose one explicitly'),
      },
    );
  }
  const offered = optedIn[0];
  if (offered) {
    return organisationChoice(
      config,
      offered.organisation,
      offered.record.label,
      offered.generation,
      options.email,
      true,
      true,
      handoffs,
    );
  }

  const ordinary = Object.entries(config.clients).find(
    ([name, row]) => row.provider === 'gmail' && !isAssociated(config, name, row),
  );
  if (ordinary) return { name: ordinary[0], clientId: ordinary[1].clientId };
  if (options.allowOwnClient) return null;

  const organisation = Object.entries(organisationsOf(config))
    .map(([name, record]) => ({ name, record, generation: activeGeneration(record) }))
    .find(({ name, generation }) => {
      if (!generation) return false;
      if (options.email !== undefined && !generationServes(generation, options.email)) return false;
      try {
        requireLiveOrganisationGeneration(config, name, generation, handoffs);
        return true;
      } catch {
        return false;
      }
    });
  if (organisation?.generation) {
    const { name, generation } = organisation;
    const client = generation.name;
    const emailWords = options.email === undefined ? [] : ['--email', options.email];
    const add = handoffs.own(['inbox', 'add', options.alias, '--client', client, ...emailWords, '--start']);
    const offer = handoffClause(
      handoffs.core(['org', 'update', name, '--for-other-addresses', 'on']),
      (command) => `let it serve other addresses with ${command}`,
      `let it serve other addresses with comms_org_update from a chat`,
    );
    const setup = handoffs.own(['setup', '--inbox', options.alias, ...emailWords]);
    throw new CommsError('CONFIG', 'no Google client is available for this new mailbox', {
      // Gmail's own two are located together, from this installation: with neither here, why, in their place.
      hint: handoffSentence(add, (addCommand) =>
        handoffSentence(
          setup,
          (setupCommand) =>
            `Choose this organisation explicitly with ${addCommand}; ${offer}; or make a client of your own with ${setupCommand}.`,
        ),
      ),
    });
  }
  const emailWords = options.email === undefined ? [] : ['--email', options.email];
  const setup = handoffs.own(['setup', '--inbox', options.alias, ...emailWords]);
  if (Object.values(organisationsOf(config)).some((record) => (record.gmail?.generations.length ?? 0) > 0)) {
    const unavailable =
      options.email === undefined
        ? 'no active, live organisation generation can be named explicitly'
        : 'no active, live organisation generation that serves this address can be named explicitly';
    throw new CommsError('CONFIG', 'no Google client is available for this new mailbox', {
      hint: handoffSentence(setup, (command) => `Make a client of your own with ${command}; ${unavailable}.`),
    });
  }
  throw new CommsError('CONFIG', 'no Google client is registered for this new mailbox', {
    hint: handoffSentence(
      setup,
      (command) => `Run ${command} to make a client of your own, or add an organisation profile first.`,
    ),
  });
}
