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

/** A WhatsApp tab opened up-front for a message that is still being built. */
export interface PendingWhatsAppShare {
  send(text: string): void;
  cancel(): void;
}

/**
 * Opens the share tab synchronously — call it inside the click handler, so
 * popup blockers allow it — and fills it in once the (async) message is ready.
 * Falls back to a fresh tab if the reserved one was blocked or closed.
 */
export function reserveWhatsAppShare(): PendingWhatsAppShare {
  const win = window.open('', '_blank');
  if (win) win.opener = null;
  return {
    send(text: string): void {
      const url = whatsAppShareUrl(text);
      if (win && !win.closed) {
        win.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },
    cancel(): void {
      win?.close();
    },
  };
}
