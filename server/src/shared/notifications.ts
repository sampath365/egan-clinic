import { prisma } from '../shared/prisma.js';
import { config } from '../shared/config.js';
import { NOTIFICATION_CHANNEL, type NotificationType } from '../shared/constants.js';

export interface NotifyInput {
  userId: string;
  clinicId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  channel?: string;
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
}

/**
 * Reusable notification service.
 *
 * The in-app channel is always persisted so the recipient sees the notification
 * in their inbox regardless of external provider configuration. Push / email /
 * WhatsApp / SMS are only attempted when the corresponding provider env vars are
 * configured — none of them are mandatory for the product to function.
 */
export const notificationService = {
  async notify(input: NotifyInput) {
    const channel = input.channel ?? NOTIFICATION_CHANNEL.IN_APP;
    const notification = await prisma.notification.create({
      data: {
        userId: input.userId,
        clinicId: input.clinicId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        channel,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        dataJson: input.data ? JSON.stringify(input.data) : null,
      },
    });

    // Best-effort external delivery. Failures never break the caller.
    void this.dispatchExternal(input, channel).catch(() => undefined);
    return notification;
  },

  async dispatchExternal(input: NotifyInput, channel: string) {
    const prefs = await prisma.notificationPreference.findUnique({ where: { userId: input.userId } });
    if (prefs) {
      const allowed = prefs.channelsJson ? (JSON.parse(prefs.channelsJson) as string[]) : ['IN_APP'];
      if (!allowed.includes(channel)) return;
    }

    if (channel === NOTIFICATION_CHANNEL.WHATSAPP && config.WHATSAPP_API_URL) {
      await fetch(config.WHATSAPP_API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.WHATSAPP_API_TOKEN ? { authorization: `Bearer ${config.WHATSAPP_API_TOKEN}` } : {}),
        },
        body: JSON.stringify({ to: input.userId, type: input.type, title: input.title, body: input.body, data: input.data }),
      }).catch(() => undefined);
    }

    if (channel === NOTIFICATION_CHANNEL.SMS && config.SMS_API_URL) {
      await fetch(config.SMS_API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.SMS_API_TOKEN ? { authorization: `Bearer ${config.SMS_API_TOKEN}` } : {}),
        },
        body: JSON.stringify({ to: input.userId, body: `${input.title}: ${input.body}` }),
      }).catch(() => undefined);
    }

    if (channel === NOTIFICATION_CHANNEL.PUSH && config.PUSH_API_URL) {
      await fetch(config.PUSH_API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.PUSH_API_TOKEN ? { authorization: `Bearer ${config.PUSH_API_TOKEN}` } : {}),
        },
        body: JSON.stringify({ userId: input.userId, title: input.title, body: input.body, data: input.data }),
      }).catch(() => undefined);
    }
  },

  /** Resolve the user account linked to a patient, if the patient has a login. */
  async notifyPatient(patientId: string, input: Omit<NotifyInput, 'userId'>) {
    const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { userId: true } });
    if (!patient?.userId) return null;
    return this.notify({ ...input, userId: patient.userId });
  },
};
