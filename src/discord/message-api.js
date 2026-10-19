export async function replyToMessage(rest, message, data) {
  return rest.post(`/channels/${message.channel_id}/messages`, {
    body: {
      ...data,
      message_reference: {
        type: 0,
        message_id: message.id,
        channel_id: message.channel_id,
        guild_id: message.guild_id,
        fail_if_not_exists: false,
      },
      allowed_mentions: {
        parse: [],
        replied_user: false,
      },
    },
  });
}
