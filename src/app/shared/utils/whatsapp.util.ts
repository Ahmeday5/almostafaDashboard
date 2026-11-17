/**
 * WhatsApp click-to-chat helpers (`wa.me`). No backend involved: WhatsApp
 * opens with the text pre-filled and the user picks / confirms the recipient.
 */

const WA_BASE = 'https://wa.me/';

/** Without a phone, WhatsApp asks the user to choose the chat. */
export function whatsAppShareUrl(text: string, phone?: string | null): string {
  const target = phone ? phone.replace(/\D/g, '') : '';
  return `${WA_BASE}${target}?text=${encodeURIComponent(text)}`;
}

export function openWhatsAppShare(text: string, phone?: string | null): void {
  window.open(whatsAppShareUrl(text, phone), '_blank', 'noopener,noreferrer');
}
