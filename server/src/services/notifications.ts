import prisma from '../lib/prisma.js';
import type { NotificationType } from '../generated/prisma/client.js';
import { logger } from '../utils/logger.js';

export type NotificationInput = {
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  actorId?: string | null;
  orderId?: string | null;
  listingId?: string | null;
};

/**
 * Fire-and-log notification creation. The caller usually doesn't care
 * whether creation succeeded — it's strictly additive to the UX, and the
 * primary action (order confirm, message send, etc.) already succeeded by
 * the time we get here. If the insert fails we log and move on.
 */
export async function createNotification(input: NotificationInput): Promise<void> {
  try {
    // Don't notify yourself — happens on e.g. admin approving their own ID,
    // or a future self-message path. Cheap guard.
    if (input.actorId && input.actorId === input.recipientId) return;
    await prisma.notification.create({ data: input });
  } catch (err) {
    logger.error('notifications.create.failed', { err: String(err) });
  }
}
