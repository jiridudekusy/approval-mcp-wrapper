import type {
  ApprovalField,
  ApprovalSection,
  JsonPrimitive,
  JsonValue,
  LocalizedMessage,
  ProposedGrantScope,
} from '@approval-mcp/contracts';
import type {
  ApprovalPlugin,
  PluginCallDescription,
  PluginCallInput,
} from '@approval-mcp/plugin-sdk';

export const MINUTES_PLUGIN_ID = 'minutes';
export const MINUTES_PLUGIN_VERSION = '1.0.0';
export const MINUTES_NORMALIZATION_VERSION = 1;

export const MINUTES_TOOL_NAMES = [
  'get_server_status',
  'list_recordings',
  'search_recordings',
  'get_recording',
  'transcribe_recording',
  'summarize_recording',
  'list_conversations',
  'list_contacts',
  'get_messages',
  'search_messages',
  'send_message',
  'set_message_reaction',
  'get_group',
  'find_groups_by_member',
  'create_group',
  'update_group_metadata',
  'add_group_members',
  'remove_group_members',
  'set_group_member_roles',
  'set_group_permissions',
  'set_group_disappearing_messages',
  'leave_group',
  'get_active_call',
  'start_call',
  'hang_up_call',
  'start_audio_recording',
  'start_video_recording',
  'pause_recording',
  'resume_recording',
  'stop_recording',
] as const;

export interface MinutesResourceReader {
  readJson(upstreamId: string, uri: string): Promise<JsonValue | undefined>;
}

interface EntityDisplay {
  id: string;
  name: string | null;
}

type Risk = NonNullable<ApprovalSection['risk']>;

function message(
  key: string,
  en: string,
  cs: string,
  params?: Readonly<Record<string, JsonPrimitive>>,
): LocalizedMessage {
  return {
    key,
    ...(params === undefined ? {} : { params }),
    fallback: { en, cs },
  };
}

function field(
  key: string,
  en: string,
  cs: string,
  value: JsonValue,
): ApprovalField {
  return { label: message(key, en, cs), value };
}

function record(value: JsonValue): Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function stringValue(
  input: Readonly<Record<string, JsonValue>>,
  key: string,
): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function entityValue(entity: EntityDisplay): JsonValue {
  return { id: entity.id, name: entity.name };
}

function entityName(entity: EntityDisplay, fallback: string): string {
  return entity.name ?? `${fallback} · ${entity.id}`;
}

function scope(
  id: string,
  path: string,
  value: string,
  target: string,
  kind: 'contact' | 'conversation' | 'group' | 'message' | 'recording',
  durations: readonly ('forever' | 'hour')[],
): ProposedGrantScope {
  const labels = {
    contact: { en: 'Contact: {target}', cs: 'Kontakt: {target}' },
    conversation: {
      en: 'Conversation: {target}',
      cs: 'Konverzace: {target}',
    },
    group: { en: 'Group: {target}', cs: 'Skupina: {target}' },
    message: { en: 'Message: {target}', cs: 'Zpráva: {target}' },
    recording: { en: 'Recording: {target}', cs: 'Nahrávka: {target}' },
  } as const;
  return {
    id,
    label: message(
      `minutes.scope.${kind}`,
      labels[kind].en,
      labels[kind].cs,
      { target },
    ),
    predicates: [{ path, operator: 'equals', value }],
    durations,
  };
}

const toolTitles: Readonly<
  Record<string, Readonly<{ en: string; cs: string }>>
> = {
  get_server_status: { en: 'Check Minutes server status', cs: 'Zjistit stav serveru Minutes' },
  list_recordings: { en: 'List recordings', cs: 'Vypsat nahrávky' },
  search_recordings: { en: 'Search recordings', cs: 'Hledat v nahrávkách' },
  get_recording: { en: 'Open a recording', cs: 'Načíst nahrávku' },
  transcribe_recording: { en: 'Transcribe a recording', cs: 'Přepsat nahrávku' },
  summarize_recording: { en: 'Summarize a recording', cs: 'Shrnout nahrávku' },
  list_conversations: { en: 'List Signal conversations', cs: 'Vypsat konverzace Signalu' },
  list_contacts: { en: 'List Signal contacts', cs: 'Vypsat kontakty Signalu' },
  get_messages: { en: 'Read messages', cs: 'Načíst zprávy' },
  search_messages: { en: 'Search messages', cs: 'Hledat ve zprávách' },
  send_message: { en: 'Send a Signal message', cs: 'Odeslat zprávu přes Signal' },
  set_message_reaction: { en: 'Change a message reaction', cs: 'Změnit reakci na zprávu' },
  get_group: { en: 'Open a Signal group', cs: 'Načíst skupinu Signalu' },
  find_groups_by_member: { en: 'Find groups by member', cs: 'Hledat skupiny podle člena' },
  create_group: { en: 'Create a Signal group', cs: 'Vytvořit skupinu Signalu' },
  update_group_metadata: { en: 'Update group details', cs: 'Upravit údaje skupiny' },
  add_group_members: { en: 'Add group members', cs: 'Přidat členy skupiny' },
  remove_group_members: { en: 'Remove group members', cs: 'Odebrat členy skupiny' },
  set_group_member_roles: { en: 'Change group member roles', cs: 'Změnit role členů skupiny' },
  set_group_permissions: { en: 'Change group permissions', cs: 'Změnit oprávnění skupiny' },
  set_group_disappearing_messages: { en: 'Change disappearing messages', cs: 'Změnit mizející zprávy' },
  leave_group: { en: 'Leave a Signal group', cs: 'Opustit skupinu Signalu' },
  get_active_call: { en: 'Check the active call', cs: 'Zjistit aktivní hovor' },
  start_call: { en: 'Start a Signal call', cs: 'Zahájit hovor přes Signal' },
  hang_up_call: { en: 'End the active call', cs: 'Ukončit aktivní hovor' },
  start_audio_recording: { en: 'Start audio recording', cs: 'Spustit audio nahrávání' },
  start_video_recording: { en: 'Start video recording', cs: 'Spustit video nahrávání' },
  pause_recording: { en: 'Pause recording', cs: 'Pozastavit nahrávání' },
  resume_recording: { en: 'Resume recording', cs: 'Pokračovat v nahrávání' },
  stop_recording: { en: 'Stop and save recording', cs: 'Ukončit a uložit nahrávání' },
};

const dangerTools = new Set([
  'hang_up_call',
  'leave_group',
  'remove_group_members',
  'set_group_member_roles',
  'set_group_permissions',
  'set_group_disappearing_messages',
  'stop_recording',
]);

const warningTools = new Set([
  'add_group_members',
  'create_group',
  'send_message',
  'set_message_reaction',
  'start_audio_recording',
  'start_call',
  'start_video_recording',
  'summarize_recording',
  'transcribe_recording',
  'update_group_metadata',
]);

function riskFor(toolName: string): Risk {
  if (dangerTools.has(toolName)) return 'danger';
  if (warningTools.has(toolName)) return 'warning';
  return 'info';
}

export class MinutesApprovalPlugin implements ApprovalPlugin {
  readonly id = MINUTES_PLUGIN_ID;
  readonly version = MINUTES_PLUGIN_VERSION;
  readonly normalizationVersion = MINUTES_NORMALIZATION_VERSION;

  constructor(private readonly resources?: MinutesResourceReader) {}

  async describe(input: PluginCallInput): Promise<PluginCallDescription> {
    const args = record(input.arguments);
    const title = toolTitles[input.toolName] ?? {
      en: `Minutes: ${input.toolName}`,
      cs: `Minutes: ${input.toolName}`,
    };
    const fields: ApprovalField[] = [];
    const proposedScopes: ProposedGrantScope[] = [];

    const resolvedTarget = await this.#describeTarget(
      input,
      args,
      fields,
      proposedScopes,
    );
    const target =
      resolvedTarget ??
      stringValue(args, 'title') ??
      stringValue(args, 'query');
    await this.#describeMembers(input, args, fields);
    this.#describeArguments(input.toolName, args, fields);

    const sections: ApprovalSection[] = [
      {
        id: 'request',
        heading: message(
          'minutes.section.request',
          'Requested operation',
          'Požadovaná operace',
        ),
        fields,
        risk: riskFor(input.toolName),
      },
    ];
    if (Object.keys(args).length > 0) {
      sections.push({
        id: 'technical',
        heading: message(
          'minutes.section.technical',
          'Technical details',
          'Technické detaily',
        ),
        fields: [
          field(
            'minutes.field.arguments',
            'Arguments',
            'Argumenty',
            structuredClone(args),
          ),
        ],
        risk: 'info',
      });
    }

    return {
      source: 'plugin',
      normalizedContext: structuredClone(args),
      sensitivePaths: [],
      title: message(
        `minutes.tool.${input.toolName}`,
        target === undefined ? title.en : `${title.en}: {target}`,
        target === undefined ? title.cs : `${title.cs}: {target}`,
        target === undefined ? undefined : { target },
      ),
      sections,
      proposedScopes,
    };
  }

  async #describeTarget(
    input: PluginCallInput,
    args: Readonly<Record<string, JsonValue>>,
    fields: ApprovalField[],
    scopes: ProposedGrantScope[],
  ): Promise<string | undefined> {
    let target: string | undefined;
    const conversationId = stringValue(args, 'conversationId');
    if (conversationId !== undefined) {
      const conversation = await this.#entity(
        input,
        'conversations',
        conversationId,
        'title',
      );
      fields.push(
        field(
          'minutes.field.conversation',
          'Conversation',
          'Konverzace',
          entityValue(conversation),
        ),
      );
      target = entityName(conversation, 'Conversation');
      scopes.push(
        scope(
          'conversation',
          '/conversationId',
          conversationId,
          entityName(conversation, 'Conversation'),
          'conversation',
          ['hour', 'forever'],
        ),
      );
    }

    const groupId = stringValue(args, 'groupId');
    if (groupId !== undefined) {
      const group = await this.#entity(
        input,
        'conversations',
        groupId,
        'title',
      );
      fields.push(
        field(
          'minutes.field.group',
          'Group',
          'Skupina',
          entityValue(group),
        ),
      );
      target ??= entityName(group, 'Group');
      const destructive = dangerTools.has(input.toolName);
      if (input.toolName !== 'leave_group') {
        scopes.push(
          scope(
            'group',
            '/groupId',
            groupId,
            entityName(group, 'Group'),
            'group',
            destructive ? ['hour'] : ['hour', 'forever'],
          ),
        );
      }
    }

    const contactId = stringValue(args, 'contactId');
    if (contactId !== undefined) {
      const contact = await this.#entity(input, 'contacts', contactId, 'title');
      fields.push(
        field(
          'minutes.field.contact',
          'Contact',
          'Kontakt',
          entityValue(contact),
        ),
      );
      target ??= entityName(contact, 'Contact');
      scopes.push(
        scope(
          'contact',
          '/contactId',
          contactId,
          entityName(contact, 'Contact'),
          'contact',
          ['hour', 'forever'],
        ),
      );
    }

    const recordingId = stringValue(args, 'recordingId');
    if (recordingId !== undefined) {
      const recording = await this.#entity(
        input,
        'recordings',
        recordingId,
        'conversationTitle',
      );
      fields.push(
        field(
          'minutes.field.recording',
          'Recording',
          'Nahrávka',
          entityValue(recording),
        ),
      );
      target ??= entityName(recording, 'Recording');
      scopes.push(
        scope(
          'recording',
          '/recordingId',
          recordingId,
          entityName(recording, 'Recording'),
          'recording',
          ['hour', 'forever'],
        ),
      );
    }

    const messageId = stringValue(args, 'messageId');
    if (messageId !== undefined) {
      const entity = { id: messageId, name: null };
      fields.push(
        field(
          'minutes.field.message',
          'Message',
          'Zpráva',
          entityValue(entity),
        ),
      );
      target ??= `ID ${messageId}`;
      scopes.push(
        scope(
          'message',
          '/messageId',
          messageId,
          `ID ${messageId}`,
          'message',
          ['hour'],
        ),
      );
    }
    return target;
  }

  #describeArguments(
    toolName: string,
    args: Readonly<Record<string, JsonValue>>,
    fields: ApprovalField[],
  ): void {
    const text = stringValue(args, 'text');
    if (text !== undefined) {
      fields.push(field('minutes.field.text', 'Message text', 'Text zprávy', text));
    }
    const query = stringValue(args, 'query');
    if (query !== undefined) {
      fields.push(field('minutes.field.query', 'Search query', 'Hledaný text', query));
    }
    const title = stringValue(args, 'title');
    if (title !== undefined) {
      fields.push(field('minutes.field.title', 'Title', 'Název', title));
    }
    const description = args['description'];
    if (typeof description === 'string') {
      fields.push(
        field('minutes.field.description', 'Description', 'Popis', description),
      );
    }
    const emoji = args['emoji'];
    if (typeof emoji === 'string' || emoji === null) {
      fields.push(
        field(
          'minutes.field.reaction',
          'Reaction',
          'Reakce',
          emoji ?? '∅',
        ),
      );
    }
    if (toolName === 'start_call') {
      fields.push(
        field(
          'minutes.field.callType',
          'Call type',
          'Typ hovoru',
          args['withVideo'] === true ? 'video' : 'audio',
        ),
      );
    }
    const settings = {
      editDetails: { en: 'Who may edit group details', cs: 'Kdo může upravovat údaje skupiny' },
      addMembers: { en: 'Who may add members', cs: 'Kdo může přidávat členy' },
      inviteLink: { en: 'Invite link mode', cs: 'Režim pozvánkového odkazu' },
      announcementsOnly: { en: 'Announcements only', cs: 'Pouze oznámení' },
      seconds: { en: 'Duration in seconds', cs: 'Doba v sekundách' },
      disappearingMessagesSeconds: { en: 'Disappearing messages', cs: 'Mizející zprávy' },
      avatarPath: { en: 'Avatar file', cs: 'Soubor avataru' },
    } as const;
    for (const [key, label] of Object.entries(settings)) {
      const value = args[key];
      if (value !== undefined) {
        fields.push(
          field(
            `minutes.field.${key}`,
            label.en,
            label.cs,
            structuredClone(value),
          ),
        );
      }
    }
  }

  async #describeMembers(
    input: PluginCallInput,
    args: Readonly<Record<string, JsonValue>>,
    fields: ApprovalField[],
  ): Promise<void> {
    const memberIds = args['memberIds'];
    if (Array.isArray(memberIds)) {
      const members = await Promise.all(
        memberIds.map(async (value, index) => {
          if (typeof value !== 'string') return value;
          if (index >= 100) return entityValue({ id: value, name: null });
          return entityValue(
            await this.#entity(input, 'contacts', value, 'title'),
          );
        }),
      );
      fields.push(
        field('minutes.field.members', 'Members', 'Členové', members),
      );
    }

    const roles = args['roles'];
    if (Array.isArray(roles)) {
      const resolvedRoles = await Promise.all(
        roles.map(async (value, index): Promise<JsonValue> => {
          const role = record(value);
          const memberId = stringValue(role, 'memberId');
          if (memberId === undefined) return structuredClone(value);
          const member =
            index >= 100
              ? { id: memberId, name: null }
              : await this.#entity(input, 'contacts', memberId, 'title');
          return {
            id: member.id,
            name: member.name,
            role:
              typeof role['role'] === 'string' ? role['role'] : 'member',
          };
        }),
      );
      fields.push(
        field(
          'minutes.field.roles',
          'Member roles',
          'Role členů',
          resolvedRoles,
        ),
      );
    }
  }

  async #entity(
    input: PluginCallInput,
    resource: 'contacts' | 'conversations' | 'recordings',
    id: string,
    nameKey: 'conversationTitle' | 'title',
  ): Promise<EntityDisplay> {
    if (this.resources === undefined) return { id, name: null };
    try {
      const value = await this.resources.readJson(
        input.upstreamId,
        `minutes://${resource}/${encodeURIComponent(id)}`,
      );
      const entity = record(value ?? {});
      const name = entity[nameKey];
      return { id, name: typeof name === 'string' ? name : null };
    } catch {
      return { id, name: null };
    }
  }
}
