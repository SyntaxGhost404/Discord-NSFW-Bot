// Every word the page shows, in one place. Short and plain.

export const TEXT = Object.freeze({
  app: 'User Lookup',
  intro: 'Enter a Discord user ID to see its public profile.',
  idLabel: 'Discord user ID',
  idPlaceholder: 'User ID',
  lookUp: 'Look up',
  clear: 'Clear',
  copy: 'Copy',
  copied: 'Copied',
  retry: 'Try again',
  loading: 'Looking up',
  rawJson: 'Raw JSON',
  footer: 'Data from the Discord API. Not affiliated with Discord.',
  fetched: (when) => `Fetched ${when}`,
  found: (name) => `Found ${name}.`,
});

export const SECTIONS = Object.freeze({
  account: 'Account',
  snowflake: 'Snowflake',
  images: 'Images',
  collectibles: 'Collectibles',
  tag: 'Server tag',
  style: 'Display name style',
  flags: 'Flags',
  other: 'Other fields',
});

export const FIELDS = Object.freeze({
  id: 'User ID',
  username: 'Username',
  displayName: 'Display name',
  discriminator: 'Discriminator',
  type: 'Account type',
  created: 'Created',
  timestamp: 'Timestamp',
  worker: 'Worker ID',
  process: 'Process ID',
  increment: 'Increment',
  avatar: 'Avatar',
  banner: 'Banner',
  bannerColor: 'Banner color',
  defaultAvatar: 'Default avatar',
  decoration: 'Avatar decoration',
  nameplate: 'Nameplate',
  sku: 'SKU',
  asset: 'Asset',
  palette: 'Palette',
  label: 'Label',
  expires: 'Expires',
  server: 'Server ID',
  tagText: 'Tag',
  shown: 'Shown',
  badge: 'Badge',
  style: 'Style',
  font: 'Font ID',
  effect: 'Effect ID',
  colors: 'Colors',
  publicFlags: 'Public flags',
  flags: 'Flags',
  premium: 'Nitro',
  mfa: 'Two-factor',
  locale: 'Language',
  verified: 'Email verified',
  email: 'Email',
});

export const VALUES = Object.freeze({
  none: 'None',
  notSet: 'Not set',
  yes: 'Yes',
  no: 'No',
  unknown: 'Unknown',
  user: 'User',
  bot: 'Bot',
  system: 'System',
  animated: 'Animated',
  still: 'Still',
  newUsername: 'None, new username',
  index: (n) => `Index ${n}`,
  never: 'Never',
  sameAsPublic: 'Same as public flags',
});

// The documented user flags, as Discord's table describes them.
export const FLAG_LABELS = Object.freeze({
  STAFF: 'Discord Employee',
  PARTNER: 'Partnered Server Owner',
  HYPESQUAD: 'HypeSquad Events',
  BUG_HUNTER_LEVEL_1: 'Bug Hunter, level 1',
  HYPESQUAD_ONLINE_HOUSE_1: 'House Bravery',
  HYPESQUAD_ONLINE_HOUSE_2: 'House Brilliance',
  HYPESQUAD_ONLINE_HOUSE_3: 'House Balance',
  PREMIUM_EARLY_SUPPORTER: 'Early Supporter',
  TEAM_PSEUDO_USER: 'Team user',
  BUG_HUNTER_LEVEL_2: 'Bug Hunter, level 2',
  VERIFIED_BOT: 'Verified Bot',
  VERIFIED_DEVELOPER: 'Early Verified Bot Developer',
  CERTIFIED_MODERATOR: 'Moderator Programs Alumni',
  BOT_HTTP_INTERACTIONS: 'HTTP interactions',
});

export const unlistedFlag = (bit) => `Unlisted flag 1 << ${bit}`;

export const FILE_LABELS = Object.freeze({ png: 'PNG', jpg: 'JPG', webp: 'WebP', gif: 'GIF' });
export const animatedFile = (label) => `${label}, animated`;

// What happened, and what to do about it. `retry` marks the ones where
// trying again can help.
export const NOTICES = Object.freeze({
  empty: { title: 'Enter a user ID.', hint: 'It is a long number, like 80351110224678912.' },
  format: { title: "That isn't a user ID.", hint: 'User IDs are 15 to 20 digits.' },
  large: { title: 'That number is too large to be an ID.', hint: 'Check for extra digits.' },
  future: { title: 'That ID would be from the future.', hint: 'Check for extra digits.' },
  unknown_user: { title: 'No account has this ID.', hint: 'It may be deleted, or belong to a server, channel, or message.' },
  slow_down: { title: 'Too many lookups.', hint: 'Wait a minute, then try again.', retry: true },
  discord_busy: { title: 'Discord is limiting lookups.', hint: 'Try again shortly.', retry: true },
  no_token: { title: "Lookups aren't set up.", hint: 'The bot token is missing.' },
  bad_token: { title: "Lookups aren't set up.", hint: 'Discord rejected the bot token.' },
  forbidden: { title: 'Discord refused the lookup.', hint: 'Try again later.', retry: true },
  discord_error: { title: 'Discord had a problem.', hint: 'Try again in a moment.', retry: true },
  unreadable: { title: "Discord's answer couldn't be read.", hint: 'Try again in a moment.', retry: true },
  timeout: { title: 'Discord took too long.', hint: 'Try again.', retry: true },
  unreachable: { title: "Couldn't reach Discord.", hint: 'Try again in a moment.', retry: true },
  offline: { title: "You're offline.", hint: 'Check your connection.', retry: true },
  network: { title: "Couldn't connect.", hint: 'Check your connection and try again.', retry: true },
  server: { title: 'Something went wrong.', hint: 'Try again.', retry: true },
});

export const waitHint = (seconds) => `Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
