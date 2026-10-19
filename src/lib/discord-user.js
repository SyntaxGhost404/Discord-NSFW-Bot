export function interactionUser(interaction) {
  return interaction.member?.user ?? interaction.user ?? null;
}

export function displayName(user) {
  return user?.global_name || user?.username || 'Unknown user';
}

export function avatarUrl(user, size = 128) {
  if (!user) return null;
  if (user.avatar) {
    const extension = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=${size}`;
  }

  const index = user.discriminator && user.discriminator !== '0'
    ? Number.parseInt(user.discriminator, 10) % 5
    : Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}
