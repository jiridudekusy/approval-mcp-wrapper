import type {
  ApprovalField,
  ApprovalSection,
  JsonPrimitive,
  JsonValue,
  LocalizedMessage,
  ProposedGrantScope,
} from '@approval-mcp/contracts';
import {
  createGenericDescription,
  type ApprovalPlugin,
  type PluginCallDescription,
  type PluginCallInput,
} from '@approval-mcp/plugin-sdk';

type Risk = NonNullable<ApprovalSection['risk']>;
type Translated = Readonly<{ en: string; cs: string }>;
interface ToolDefinition extends Translated {
  risk: Risk;
  fields: readonly string[];
  scopeKey?: string;
}

function tool(
  en: string,
  cs: string,
  risk: Risk,
  fields: readonly string[] = [],
  scopeKey?: string,
): ToolDefinition {
  return { en, cs, risk, fields, ...(scopeKey === undefined ? {} : { scopeKey }) };
}

/** Tool names and argument keys were verified against the connected MCP catalog. */
export const CONNECTED_TOOL_DEFINITIONS = {
  email: {
    attachment: tool('Open email attachment', 'Otevřít přílohu e-mailu', 'info', ['id', 'part']),
    count: tool('Count emails', 'Spočítat e-maily', 'info', ['account', 'query'], 'account'),
    ids: tool('List email IDs', 'Vypsat ID e-mailů', 'info', ['account', 'query'], 'account'),
    refresh: tool('Sync email account', 'Synchronizovat e-mailový účet', 'warning', ['account']),
    search: tool('Search emails', 'Hledat v e-mailech', 'info', ['account', 'query'], 'account'),
    show: tool('Read email', 'Přečíst e-mail', 'info', ['id']),
    status: tool('Check email sync', 'Zjistit stav synchronizace e-mailů', 'info'),
    text: tool('Read email text', 'Přečíst text e-mailu', 'info', ['id']),
    thread: tool('Read email thread', 'Přečíst e-mailové vlákno', 'info', ['id']),
  },
  geo: {
    devices: tool('Locate tracked devices', 'Zjistit polohu sledovaných zařízení', 'warning', ['person']),
    last_visit: tool('Find last visit', 'Zjistit poslední návštěvu místa', 'warning', ['person', 'place'], 'person'),
    place_add: tool('Add tracked place', 'Přidat sledované místo', 'warning', ['person', 'name', 'lat', 'lon', 'radius']),
    places: tool('List tracked places', 'Vypsat sledovaná místa', 'warning', ['person'], 'person'),
    status: tool('Check location service', 'Zjistit stav polohové služby', 'info'),
    timeline: tool('Read location timeline', 'Načíst historii polohy', 'warning', ['person', 'from', 'to', 'device'], 'person'),
    visits: tool('Read detected visits', 'Načíst zjištěné návštěvy', 'warning', ['person', 'place', 'from', 'to'], 'person'),
    where_is: tool('Find current location', 'Zjistit aktuální polohu', 'warning', ['person', 'refresh'], 'person'),
  },
  imcp: {
    calendars_list: tool('List calendars', 'Vypsat kalendáře', 'info'),
    contacts_create: tool('Create contact', 'Vytvořit kontakt', 'warning', ['givenName', 'familyName', 'organizationName', 'emailAddresses', 'phoneNumbers']),
    contacts_list: tool('List contacts', 'Vypsat kontakty', 'info', ['limit']),
    contacts_me: tool('Read my contact', 'Načíst můj kontakt', 'info'),
    contacts_search: tool('Search contacts', 'Hledat kontakty', 'info', ['name', 'email', 'phone']),
    contacts_update: tool('Update contact', 'Upravit kontakt', 'warning', ['identifier', 'givenName', 'familyName', 'organizationName', 'emailAddresses', 'phoneNumbers']),
    events_create: tool('Create calendar event', 'Vytvořit událost v kalendáři', 'warning', ['title', 'start', 'end', 'calendar', 'location', 'isRecurring']),
    events_delete: tool('Delete calendar event', 'Smazat událost z kalendáře', 'danger', ['identifier', 'start', 'span']),
    events_fetch: tool('Read calendar events', 'Načíst události kalendáře', 'info', ['calendars', 'query', 'start', 'end']),
    location_current: tool('Read current location', 'Zjistit aktuální polohu', 'warning'),
    location_geocode: tool('Geocode address', 'Vyhledat souřadnice adresy', 'info', ['address']),
    'location_reverse-geocode': tool('Find address by coordinates', 'Zjistit adresu podle souřadnic', 'info', ['latitude', 'longitude']),
    maps_directions: tool('Plan route', 'Naplánovat trasu', 'info', ['originAddress', 'destinationAddress', 'originCoordinates', 'destinationCoordinates', 'transportType']),
    maps_eta: tool('Calculate travel time', 'Spočítat dobu cesty', 'info', ['originLatitude', 'originLongitude', 'destinationLatitude', 'destinationLongitude', 'transportType']),
    maps_explore: tool('Find nearby places', 'Najít místa v okolí', 'info', ['category', 'latitude', 'longitude', 'radius']),
    maps_generate: tool('Generate map image', 'Vytvořit obrázek mapy', 'info', ['latitude', 'longitude', 'mapType']),
    maps_search: tool('Search places', 'Hledat místa', 'info', ['query']),
    messages_fetch: tool('Read messages', 'Načíst zprávy', 'info', ['participants', 'query', 'start', 'end']),
    phone_call: tool('Start phone call', 'Zahájit telefonní hovor', 'warning', ['phoneNumber']),
    phone_calls_fetch: tool('Read call history', 'Načíst historii hovorů', 'info', ['participant', 'call_type', 'start', 'end']),
    reminders_create: tool('Create reminder', 'Vytvořit připomínku', 'warning', ['title', 'due', 'list', 'priority']),
    reminders_fetch: tool('Read reminders', 'Načíst připomínky', 'info', ['lists', 'query', 'completed', 'start', 'end']),
    reminders_lists: tool('List reminder lists', 'Vypsat seznamy připomínek', 'info'),
    weather_current: tool('Read current weather', 'Zjistit aktuální počasí', 'info', ['latitude', 'longitude']),
    weather_daily: tool('Read daily forecast', 'Načíst denní předpověď', 'info', ['latitude', 'longitude', 'days']),
    weather_hourly: tool('Read hourly forecast', 'Načíst hodinovou předpověď', 'info', ['latitude', 'longitude', 'hours']),
    weather_minute: tool('Read minute forecast', 'Načíst minutovou předpověď', 'info', ['latitude', 'longitude', 'minutes']),
  },
  krkonoskewellness: {
    availability: tool('Check wellness availability', 'Zjistit volné termíny wellness', 'info', ['service_id', 'from', 'to', 'therapist_id']),
    book: tool('Book wellness service', 'Rezervovat wellness službu', 'danger', ['service_id', 'start', 'therapist_id', 'name', 'email', 'phone', 'note', 'confirm']),
    my_bookings: tool('List wellness bookings', 'Vypsat wellness rezervace', 'info', ['upcoming_only']),
    services: tool('List wellness services', 'Vypsat wellness služby', 'info', ['refresh']),
  },
  whatsapp: {
    download_media: tool('Download WhatsApp media', 'Stáhnout médium z WhatsAppu', 'warning', ['chat_jid', 'message_id'], 'chat_jid'),
    get_chat: tool('Open WhatsApp chat', 'Načíst chat WhatsAppu', 'info', ['chat_jid']),
    get_contact_chats: tool('List chats with contact', 'Vypsat chaty s kontaktem', 'info', ['jid']),
    get_direct_chat_by_contact: tool('Find direct chat', 'Najít přímý chat', 'info', ['sender_phone_number']),
    get_last_interaction: tool('Read last interaction', 'Načíst poslední interakci', 'info', ['jid']),
    get_message_context: tool('Read message context', 'Načíst okolí zprávy', 'info', ['message_id']),
    list_chats: tool('List WhatsApp chats', 'Vypsat chaty WhatsAppu', 'info', ['query', 'sort_by']),
    list_messages: tool('Read WhatsApp messages', 'Načíst zprávy WhatsAppu', 'info', ['chat_jid', 'sender_phone_number', 'query', 'after', 'before']),
    search_contacts: tool('Search WhatsApp contacts', 'Hledat kontakty WhatsAppu', 'info', ['query']),
    send_audio_message: tool('Send WhatsApp audio message', 'Odeslat hlasovou zprávu přes WhatsApp', 'warning', ['recipient', 'media_path'], 'recipient'),
    send_file: tool('Send WhatsApp file', 'Odeslat soubor přes WhatsApp', 'warning', ['recipient', 'media_path'], 'recipient'),
    send_message: tool('Send WhatsApp message', 'Odeslat zprávu přes WhatsApp', 'warning', ['recipient', 'message'], 'recipient'),
    sync_chat_history: tool('Sync WhatsApp chat history', 'Synchronizovat historii chatu WhatsAppu', 'warning', ['chat_jid', 'count'], 'chat_jid'),
  },
} as const satisfies Record<string, Record<string, ToolDefinition>>;

export type ConnectedPluginId = keyof typeof CONNECTED_TOOL_DEFINITIONS;

export interface ConnectedContactLookup {
  findContact(upstreamId: string, source: 'whatsapp' | 'imcp', identifier: string): Promise<unknown>;
  findChat?(upstreamId: string, identifier: string): Promise<unknown>;
  findMessage?(upstreamId: string, identifier: string): Promise<unknown>;
}

interface ContactDisplay {
  id: string;
  name: string | null;
}

function contactValue(contact: ContactDisplay): JsonValue {
  return { id: contact.id, name: contact.name };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonemptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function sameContact(left: string, right: string): boolean {
  if (left === right) return true;
  if ((left.includes('@') && !left.endsWith('@s.whatsapp.net')) ||
      (right.includes('@') && !right.endsWith('@s.whatsapp.net'))) return false;
  const leftPhone = left.replace(/@s\.whatsapp\.net$/i, '').replace(/[^0-9]/g, '');
  const rightPhone = right.replace(/@s\.whatsapp\.net$/i, '').replace(/[^0-9]/g, '');
  return leftPhone.length >= 7 && leftPhone === rightPhone;
}

function contactName(value: Record<string, unknown>, identifier: string): string | undefined {
  const ids = ['jid', 'id', 'identifier', 'chat_jid', 'chatJid', 'phone', 'phoneNumber', 'phone_number', 'number', 'wa_id']
    .map((key) => nonemptyString(value[key]))
    .filter((candidate): candidate is string => candidate !== undefined);
  const phoneNumbers = value['phoneNumbers'];
  if (Array.isArray(phoneNumbers)) {
    for (const phone of phoneNumbers) {
      const item = objectValue(phone);
      const candidate = nonemptyString(item?.['value'] ?? item?.['number'] ?? phone);
      if (candidate !== undefined) ids.push(candidate);
    }
  }
  if (!ids.some((candidate) => sameContact(candidate, identifier))) return undefined;
  const name = ['displayName', 'display_name', 'fullName', 'full_name', 'formattedName', 'pushName', 'push_name', 'subject', 'title', 'chatName', 'name']
    .map((key) => nonemptyString(value[key]))
    .find((candidate) => candidate !== undefined && !sameContact(candidate, identifier));
  return name?.slice(0, 100);
}

function findContactName(result: unknown, identifier: string): string | undefined {
  const pending: unknown[] = [result];
  let inspected = 0;
  while (pending.length > 0 && inspected < 100) {
    const value = pending.shift();
    inspected += 1;
    if (Array.isArray(value)) {
      pending.push(...value.slice(0, 100));
      continue;
    }
    const record = objectValue(value);
    if (record === undefined) continue;
    const name = contactName(record, identifier);
    if (name !== undefined) return name;
    for (const key of ['structuredContent', 'content', 'contacts', 'chats', 'chat', 'results', 'items', 'data']) {
      const nested = record[key];
      if (nested !== undefined) pending.push(nested);
    }
    const text = nonemptyString(record['text']);
    if (text !== undefined && (text.startsWith('{') || text.startsWith('['))) {
      try { pending.push(JSON.parse(text) as unknown); } catch { /* A non-JSON tool message is not a contact. */ }
    }
  }
  return undefined;
}

interface MessageDisplay {
  id: string;
  text?: string;
  chatId?: string;
}

function findMessage(result: unknown, identifier: string): MessageDisplay | undefined {
  const pending: unknown[] = [result];
  let inspected = 0;
  while (pending.length > 0 && inspected < 100) {
    const value = pending.shift();
    inspected += 1;
    if (Array.isArray(value)) {
      pending.push(...value.slice(0, 100));
      continue;
    }
    const record = objectValue(value);
    if (record === undefined) continue;
    const id = nonemptyString(record['message_id'] ?? record['messageId'] ?? record['id']);
    if (id === identifier) {
      const text = nonemptyString(record['body'] ?? record['text'] ?? record['caption'] ?? record['content']);
      const chatId = nonemptyString(record['chat_jid'] ?? record['chatJid'] ?? record['remoteJid']);
      return { id, ...(text === undefined ? {} : { text }), ...(chatId === undefined ? {} : { chatId }) };
    }
    for (const key of ['structuredContent', 'content', 'message', 'messages', 'results', 'items', 'data']) {
      const nested = record[key];
      if (nested !== undefined) pending.push(nested);
    }
    const text = nonemptyString(record['text']);
    if (text !== undefined && (text.startsWith('{') || text.startsWith('['))) {
      try { pending.push(JSON.parse(text) as unknown); } catch { /* Ignore plain text. */ }
    }
  }
  return undefined;
}

function contactIdentifierKey(pluginId: ConnectedPluginId, toolName: string): string | undefined {
  if (pluginId === 'whatsapp') {
    if (['send_message', 'send_file', 'send_audio_message'].includes(toolName)) return 'recipient';
    if (['get_contact_chats', 'get_last_interaction'].includes(toolName)) return 'jid';
    if (toolName === 'get_direct_chat_by_contact') return 'sender_phone_number';
  }
  if (pluginId === 'imcp' && toolName === 'phone_call') return 'phoneNumber';
  return undefined;
}

function chatIdentifierKey(pluginId: ConnectedPluginId, toolName: string): string | undefined {
  if (pluginId !== 'whatsapp') return undefined;
  if (['download_media', 'get_chat', 'list_messages', 'sync_chat_history'].includes(toolName)) return 'chat_jid';
  if (['send_message', 'send_file', 'send_audio_message'].includes(toolName)) return 'recipient';
  return undefined;
}

const labels: Readonly<Record<string, Translated>> = {
  account: { en: 'Account', cs: 'Účet' },
  address: { en: 'Address', cs: 'Adresa' },
  after: { en: 'After', cs: 'Po' },
  before: { en: 'Before', cs: 'Před' },
  calendar: { en: 'Calendar', cs: 'Kalendář' },
  calendars: { en: 'Calendars', cs: 'Kalendáře' },
  call_type: { en: 'Call type', cs: 'Typ hovoru' },
  category: { en: 'Category', cs: 'Kategorie' },
  chat_jid: { en: 'Chat', cs: 'Chat' },
  completed: { en: 'Completed', cs: 'Dokončené' },
  confirm: { en: 'Create binding booking', cs: 'Vytvořit závaznou rezervaci' },
  count: { en: 'Count', cs: 'Počet' },
  days: { en: 'Days', cs: 'Dny' },
  destinationAddress: { en: 'Destination', cs: 'Cíl' },
  destinationCoordinates: { en: 'Destination coordinates', cs: 'Souřadnice cíle' },
  destinationLatitude: { en: 'Destination latitude', cs: 'Zeměpisná šířka cíle' },
  destinationLongitude: { en: 'Destination longitude', cs: 'Zeměpisná délka cíle' },
  device: { en: 'Device', cs: 'Zařízení' },
  due: { en: 'Due', cs: 'Termín' },
  email: { en: 'Email', cs: 'E-mail' },
  emailAddresses: { en: 'Email addresses', cs: 'E-mailové adresy' },
  end: { en: 'End', cs: 'Konec' },
  familyName: { en: 'Family name', cs: 'Příjmení' },
  from: { en: 'From', cs: 'Od' },
  givenName: { en: 'Given name', cs: 'Jméno' },
  hours: { en: 'Hours', cs: 'Hodiny' },
  id: { en: 'Message ID', cs: 'ID zprávy' },
  identifier: { en: 'Identifier', cs: 'Identifikátor' },
  isRecurring: { en: 'Recurring', cs: 'Opakování' },
  jid: { en: 'Contact', cs: 'Kontakt' },
  lat: { en: 'Latitude', cs: 'Zeměpisná šířka' },
  latitude: { en: 'Latitude', cs: 'Zeměpisná šířka' },
  limit: { en: 'Limit', cs: 'Limit' },
  list: { en: 'Reminder list', cs: 'Seznam připomínek' },
  lists: { en: 'Reminder lists', cs: 'Seznamy připomínek' },
  location: { en: 'Location', cs: 'Místo' },
  lon: { en: 'Longitude', cs: 'Zeměpisná délka' },
  longitude: { en: 'Longitude', cs: 'Zeměpisná délka' },
  mapType: { en: 'Map type', cs: 'Typ mapy' },
  media_path: { en: 'File path', cs: 'Cesta k souboru' },
  message: { en: 'Message text', cs: 'Text zprávy' },
  message_id: { en: 'Message ID', cs: 'ID zprávy' },
  minutes: { en: 'Minutes', cs: 'Minuty' },
  name: { en: 'Name', cs: 'Jméno' },
  note: { en: 'Note', cs: 'Poznámka' },
  organizationName: { en: 'Organization', cs: 'Organizace' },
  originAddress: { en: 'Origin', cs: 'Výchozí bod' },
  originCoordinates: { en: 'Origin coordinates', cs: 'Souřadnice počátku' },
  originLatitude: { en: 'Origin latitude', cs: 'Zeměpisná šířka počátku' },
  originLongitude: { en: 'Origin longitude', cs: 'Zeměpisná délka počátku' },
  part: { en: 'Attachment part', cs: 'Část přílohy' },
  participant: { en: 'Participant', cs: 'Účastník' },
  participants: { en: 'Participants', cs: 'Účastníci' },
  person: { en: 'Person', cs: 'Osoba' },
  phone: { en: 'Phone', cs: 'Telefon' },
  phoneNumber: { en: 'Phone number', cs: 'Telefonní číslo' },
  phoneNumbers: { en: 'Phone numbers', cs: 'Telefonní čísla' },
  place: { en: 'Place', cs: 'Místo' },
  priority: { en: 'Priority', cs: 'Priorita' },
  query: { en: 'Search query', cs: 'Hledaný text' },
  radius: { en: 'Radius', cs: 'Poloměr' },
  recipient: { en: 'Recipient', cs: 'Příjemce' },
  refresh: { en: 'Refresh', cs: 'Aktualizovat' },
  sender_phone_number: { en: 'Sender', cs: 'Odesílatel' },
  service_id: { en: 'Service ID', cs: 'ID služby' },
  sort_by: { en: 'Sort by', cs: 'Řadit podle' },
  span: { en: 'Deletion range', cs: 'Rozsah smazání' },
  start: { en: 'Start', cs: 'Začátek' },
  therapist_id: { en: 'Therapist ID', cs: 'ID masérky' },
  title: { en: 'Title', cs: 'Název' },
  to: { en: 'To', cs: 'Do' },
  transportType: { en: 'Transport', cs: 'Doprava' },
  upcoming_only: { en: 'Upcoming only', cs: 'Jen budoucí' },
};

function message(key: string, fallback: Translated, params?: Readonly<Record<string, JsonPrimitive>>): LocalizedMessage {
  return { key, fallback, ...(params === undefined ? {} : { params }) };
}

function argumentsRecord(value: JsonValue): Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function targetValue(value: JsonValue | undefined): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value.slice(0, 100);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function scopedGrant(pluginId: ConnectedPluginId, key: string, value: string): ProposedGrantScope {
  const label = labels[key] ?? { en: key, cs: key };
  return {
    id: key,
    label: message(`${pluginId}.scope.${key}`, {
      en: `${label.en}: {target}`,
      cs: `${label.cs}: {target}`,
    }, { target: value.slice(0, 100) }),
    predicates: [{ path: `/${key}`, operator: 'equals', value }],
    durations: ['hour'],
  };
}

export class ConnectedApprovalPlugin implements ApprovalPlugin {
  readonly version = '1.0.0';
  readonly normalizationVersion = 2;

  constructor(readonly id: ConnectedPluginId, private readonly contacts?: ConnectedContactLookup) {}

  async describe(input: PluginCallInput): Promise<PluginCallDescription> {
    const definitions = CONNECTED_TOOL_DEFINITIONS[this.id] as Readonly<Record<string, ToolDefinition>>;
    const definition = definitions[input.toolName];
    if (definition === undefined) {
      return createGenericDescription(input, 'plugin.tool_unknown');
    }
    const args = argumentsRecord(input.arguments);
    const contactKey = contactIdentifierKey(this.id, input.toolName);
    const contactId = contactKey === undefined ? undefined : nonemptyString(args[contactKey]);
    const chatKey = chatIdentifierKey(this.id, input.toolName);
    const chatId = chatKey === undefined ? undefined : nonemptyString(args[chatKey]);
    let contact: ContactDisplay | undefined;
    if (contactId !== undefined) {
      let name: string | undefined;
      if (this.contacts !== undefined) {
        try {
          name = findContactName(await this.contacts.findContact(input.upstreamId, this.id as 'whatsapp' | 'imcp', contactId), contactId);
        } catch { /* Contact lookup must never prevent an approval request. */ }
      }
      contact = { id: contactId, name: name ?? null };
    }
    let chat: ContactDisplay | undefined;
    if (chatId !== undefined) {
      let name = contactId === chatId ? contact?.name ?? undefined : undefined;
      if (name === undefined && this.contacts?.findChat !== undefined) {
        try {
          name = findContactName(await this.contacts.findChat(input.upstreamId, chatId), chatId);
        } catch { /* Chat lookup must never prevent an approval request. */ }
      }
      if (name === undefined && this.contacts !== undefined) {
        try {
          name = findContactName(await this.contacts.findContact(input.upstreamId, 'whatsapp', chatId), chatId);
        } catch { /* Contact lookup is only a fallback for a direct chat. */ }
      }
      chat = { id: chatId, name: name ?? null };
    }
    const messageId = this.id === 'whatsapp' ? nonemptyString(args['message_id']) : undefined;
    let referencedMessage: MessageDisplay | undefined;
    if (messageId !== undefined && this.contacts?.findMessage !== undefined) {
      try {
        referencedMessage = findMessage(await this.contacts.findMessage(input.upstreamId, messageId), messageId);
      } catch { /* Message lookup must never prevent an approval request. */ }
    }
    if (chat === undefined && referencedMessage?.chatId !== undefined) {
      let name: string | undefined;
      if (this.contacts?.findChat !== undefined) {
        try {
          name = findContactName(await this.contacts.findChat(input.upstreamId, referencedMessage.chatId), referencedMessage.chatId);
        } catch { /* Chat lookup must never prevent an approval request. */ }
      }
      chat = { id: referencedMessage.chatId, name: name ?? null };
    }
    const fields: ApprovalField[] = definition.fields.flatMap((key) => {
      const value = args[key];
      if (value === undefined) return [];
      return [{
        label: message(`${this.id}.field.${key}`, labels[key] ?? { en: key, cs: key }),
        value: key === chatKey && chat !== undefined
          ? contactValue(chat)
          : key === contactKey && contact !== undefined ? contactValue(contact) : structuredClone(value),
      }];
    });
    if (referencedMessage?.text !== undefined) {
      fields.push({
        label: message(`${this.id}.field.message_text`, { en: 'Message text', cs: 'Text zprávy' }),
        value: referencedMessage.text,
      });
    }
    if (chatKey === undefined && chat !== undefined) {
      fields.unshift({
        label: message(`${this.id}.field.chat_jid`, labels['chat_jid']!),
        value: contactValue(chat),
      });
    }
    const rawTarget = definition.fields.map((key) => targetValue(args[key])).find((value) => value !== undefined);
    const namedTarget = chat?.name !== null && chat?.name !== undefined
      ? chat
      : contact?.name !== null && contact?.name !== undefined ? contact : undefined;
    const target = namedTarget === undefined
      ? rawTarget
      : `${namedTarget.name} (${namedTarget.id})`.slice(0, 200);
    const risk = this.id === 'krkonoskewellness' && input.toolName === 'book' && args['confirm'] !== true
      ? 'info'
      : definition.risk;
    const sections: ApprovalSection[] = [{
      id: 'request',
      heading: message(`${this.id}.section.request`, { en: 'Requested operation', cs: 'Požadovaná operace' }),
      fields,
      risk,
    }];
    if (Object.keys(args).length > 0) {
      sections.push({
        id: 'technical',
        heading: message(`${this.id}.section.technical`, { en: 'All arguments', cs: 'Všechny argumenty' }),
        fields: [{
          label: message(`${this.id}.field.arguments`, { en: 'Tool arguments', cs: 'Argumenty nástroje' }),
          value: structuredClone(args),
        }],
        risk: 'info',
      });
    }
    const scopeKey = definition.scopeKey;
    const rawScopeValue = scopeKey === undefined ? undefined : args[scopeKey];
    const scopeValue = typeof rawScopeValue === 'string' && rawScopeValue.length > 0 ? rawScopeValue : undefined;
    const bookingPreview = this.id === 'krkonoskewellness' && input.toolName === 'book' && args['confirm'] !== true;
    return {
      source: 'plugin',
      normalizedContext: structuredClone(args),
      sensitivePaths: [],
      title: message(`${this.id}.tool.${input.toolName}`, {
        en: bookingPreview
          ? target === undefined ? 'Preview wellness booking' : 'Preview wellness booking: {target}'
          : target === undefined ? definition.en : `${definition.en}: {target}`,
        cs: bookingPreview
          ? target === undefined ? 'Zobrazit návrh wellness rezervace' : 'Zobrazit návrh wellness rezervace: {target}'
          : target === undefined ? definition.cs : `${definition.cs}: {target}`,
      }, target === undefined ? undefined : { target }),
      sections,
      proposedScopes: scopeKey === undefined || scopeValue === undefined
        ? []
        : [scopedGrant(this.id, scopeKey, scopeValue)],
    };
  }
}

export function connectedApprovalPlugins(contacts?: ConnectedContactLookup): readonly ApprovalPlugin[] {
  return (Object.keys(CONNECTED_TOOL_DEFINITIONS) as ConnectedPluginId[])
    .map((id) => new ConnectedApprovalPlugin(id, contacts));
}
