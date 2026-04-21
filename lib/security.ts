import { z } from 'zod';

export const leadWebhookSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(1).optional(),
  phone: z.string().min(7)
});

export const telnyxWebhookSchema = z.object({
  companyId: z.string().min(1),
  messageId: z.string().min(1),
  from: z.string().min(7),
  text: z.string().min(1)
});
