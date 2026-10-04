import {
  activeGeneration,
  type ClientConfig,
  CommsError,
  type Config,
  type OrganisationGeneration,
  organisationsOf,
  parseName,
  requireLiveOrganisationGeneration,
} from '@agentcomms/core';

/** The client decision recorded in a new-inbox consent flow (design 2026-10-02 §D6). */
export interface GmailClientChoice {
  name: string;
  clientId: string;
  organisation?: string | undefined;
  organisationLabel?: string | undefined;
  generation?: OrganisationGeneration | undefined;
  /** Whether this route depended on the generation still being the organisation's active one. */
  activeGeneration?: boolean | undefined;
}

export interface GmailClientChoiceOptions {
  alias: string;
  email?: string | undefined;
  client?: string | undefined;
  /** Setup can make a client when no existing one is eligible; inbox add must refuse instead. */
  allowOwnClient?: boolean | undefined;
}

function generationNamed(
  config: Config,
  name: string,
): { organisation: string; label: string; generation: OrganisationGeneration } | undefined {
  for (const [organisation, record] of Object.entries(organisationsOf(config)).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const generation = record.gmail?.generations.find((candidate) => candidate.name === name);
    if (generation) return { organisation, label: record.label, generation };
  }
  return undefined;
}

/** The organisation whose owned or adopted generation names this live client row, if there is one. */
export function organisationForClient(config: Config, name: string): string | undefined {
  const found = generationNamed(config, name);
  const row = config.clients[name];
  return found && row?.clientId === found.generation.clientId ? found.organisation : undefined;
}

function isAssociated(config: Config, name: string, row: ClientConfig): boolean {
  if (typeof row.organisation === 'string') return true;
  return Object.values(organisationsOf(config)).some((record) =>
    record.gmail?.generations.some((generation) => generation.name === name),
  );
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
): void {
  if (email === undefined || generationServes(generation, email)) return;
  throw new CommsError(
    'CONFIG',
    `the organisation ${organisation} says its Google client "${generation.name}" does not serve ${email}`,
    {
      hint: `Run the command again with --client <name> for a client that serves this address.`,
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
): GmailClientChoice {
  const row = requireLiveOrganisationGeneration(config, organisation, generation);
  refuseOutsideDomains(organisation, generation, email);
  return {
    name: generation.name,
    clientId: row.clientId,
    organisation,
    organisationLabel: label,
    generation,
    activeGeneration: active,
  };
}

/**
 * Chooses a client before a new-mailbox consent link is built, in the exact order of design 2026-10-02 §D6.
 * Import never calls this function: an imported refresh token remains bound to the client it arrived with.
 */
export function chooseClientForNewInbox(config: Config, options: GmailClientChoiceOptions): GmailClientChoice | null {
  if (options.client !== undefined) {
    const managed = generationNamed(config, options.client);
    if (managed) {
      return organisationChoice(config, managed.organisation, managed.label, managed.generation, options.email, false);
    }
    const row = config.clients[options.client];
    if (!row) {
      throw new CommsError('CONFIG', `no OAuth client called "${options.client}" is registered`, {
        hint: 'Add one with `agent-gmail client add <client_secret.json>`.',
      });
    }
    if (row.provider !== 'gmail') {
      throw new CommsError('CONFIG', `"${options.client}" is not a Google OAuth client`, {
        hint: 'Choose a client listed by `agent-gmail client list`.',
      });
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
    if (record && active) return organisationChoice(config, parsed.org, record.label, active, options.email, true);
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
      { hint: 'Run the command again with --client <name> to choose one.' },
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
    );
  }

  const ordinary = Object.entries(config.clients).find(
    ([name, row]) => row.provider === 'gmail' && !isAssociated(config, name, row),
  );
  if (ordinary) return { name: ordinary[0], clientId: ordinary[1].clientId };
  if (options.allowOwnClient) return null;

  const organisation = Object.entries(organisationsOf(config)).find(
    ([, record]) => (record.gmail?.generations.length ?? 0) > 0,
  );
  if (organisation) {
    const [name, record] = organisation;
    const generation = record.gmail?.generations.at(-1);
    throw new CommsError('CONFIG', 'no Google client is available for this new mailbox', {
      hint:
        `Choose this organisation explicitly with --client ${generation?.name ?? `${name}-1`}; ` +
        'let it serve other addresses with `agentcomms org update ' +
        name +
        ' --for-other-addresses on`; ' +
        'or run `agent-gmail setup` to make a client of your own.',
    });
  }
  throw new CommsError('CONFIG', 'no Google client is registered for this new mailbox', {
    hint: 'Run `agent-gmail setup` to make a client of your own, or add an organisation profile first.',
  });
}
