import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { configFor } from '../../src/config.js';
import { mediaMessage } from '../../src/brain/media-command.js';
import { DiscordRest } from '../../src/discord/rest.js';
import { replyToMessage, welcomePayload } from '../../src/gateway/mention.js';
import { PNG_BYTES } from '../helpers/fetch-mock.js';

// Posts the bot's real message shapes with harmless content to the channel in
// LIVE_TEST_CHANNEL_ID, checks Discord's interpretation, then deletes them.
const channelId = env.LIVE_TEST_CHANNEL_ID;
const specification = { name: 'cosplay', title: 'Live Payload Check' };
const context = {
  interaction: { id: '1', member: { user: { id: '794482283993235478', username: 'payload-check', global_name: 'Payload Check', avatar: null } } },
};

describe.skipIf(!channelId)('live Discord payloads', () => {
  it('are accepted by Discord exactly as the bot builds them', async () => {
    const config = configFor(env);
    const rest = new DiscordRest({ token: config.botToken });
    const created = [];
    try {
      const urlMessage = mediaMessage(specification, context, {}, {
        provider: 'live-check',
        url: 'https://cdn.discordapp.com/embed/avatars/0.png',
        watchUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
      });
      const first = await rest.post(`/channels/${channelId}/messages`, { body: urlMessage.body });
      created.push(first.id);
      expect(first.embeds[0].image.url).toBe('https://cdn.discordapp.com/embed/avatars/0.png');
      expect(first.components[0].components.map((item) => item.custom_id ?? item.url))
        .toEqual(['m:cosplay', 'https://cdn.discordapp.com/embed/avatars/0.png']);

      const attachment = mediaMessage(specification, context, {}, {
        provider: 'live-check',
        url: 'https://example.com/source.png',
        buffer: PNG_BYTES,
        contentType: 'image/png',
        fileName: 'media.png',
      });
      const second = await rest.post(`/channels/${channelId}/messages`, { body: attachment.body, files: attachment.files });
      created.push(second.id);
      // Discord moves a file referenced by the embed into the embed itself.
      expect(second.embeds[0].image).toMatchObject({ width: 1, height: 1, content_type: 'image/png' });
      expect(second.embeds[0].image.url).toMatch(/^https:\/\/cdn\.discordapp\.com\/attachments\/.+\/media\.png/);

      // The refresh flow edits a message that may hold an attachment and must
      // drop it when the new media is a plain URL.
      const edited = await rest.patch(`/channels/${channelId}/messages/${second.id}`, { body: urlMessage.body });
      expect(edited.attachments).toHaveLength(0);
      expect(edited.embeds[0].image.url).toBe('https://cdn.discordapp.com/embed/avatars/0.png');

      const bot = await rest.get('/users/@me');
      const reply = await replyToMessage(rest, { id: first.id, channel_id: channelId, guild_id: first.guild_id }, welcomePayload(bot));
      created.push(reply.id);
      expect(reply.message_reference.message_id).toBe(first.id);
      expect(reply.embeds[0].title).toContain(`Welcome to ${bot.username}`);
      expect(reply.components[0].components.map((item) => item.custom_id)).toEqual(['intro:features', 'intro:support']);
    } finally {
      for (const id of created.reverse()) {
        await rest.delete(`/channels/${channelId}/messages/${id}`).catch((error) => console.log('cleanup failed', id, error.message));
      }
    }
  });
});
