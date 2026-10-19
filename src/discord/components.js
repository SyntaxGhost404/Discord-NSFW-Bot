import { ButtonStyle, ComponentType, TextInputStyle } from './constants.js';
import { toComponentEmoji } from '../config/emojis.js';

export function actionRow(...components) {
  return { type: ComponentType.ACTION_ROW, components: components.flat() };
}

export function button({ customId, label, emoji, style = ButtonStyle.PRIMARY, url, disabled = false }) {
  if (!label && !emoji) throw new Error('A Discord button requires a label or emoji.');
  const component = { type: ComponentType.BUTTON, style, disabled };
  if (label) component.label = label;
  if (emoji) component.emoji = toComponentEmoji(emoji);
  if (style === ButtonStyle.LINK) component.url = url;
  else component.custom_id = customId;
  return component;
}

export function shortTextInput({ customId, label, required = true, placeholder, minLength, maxLength }) {
  const component = {
    type: ComponentType.TEXT_INPUT,
    custom_id: customId,
    label,
    style: TextInputStyle.SHORT,
    required,
  };
  if (placeholder) component.placeholder = placeholder;
  if (minLength !== undefined) component.min_length = minLength;
  if (maxLength !== undefined) component.max_length = maxLength;
  return component;
}
