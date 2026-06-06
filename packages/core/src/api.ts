import { z } from 'zod';
import { ContainerSchema } from './container';
import { TokenSchema } from './token';

export const PublishRequestSchema = z.object({
  title: z.string().min(1),
  contentBase64: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
  ownerId: z.string().min(1),
});
export type PublishRequest = z.infer<typeof PublishRequestSchema>;

export const TitleSchema = z.object({
  doc: z.string(),
  title: z.string(),
  priceCents: z.number().int(),
  ownerId: z.string(),
});
export type Title = z.infer<typeof TitleSchema>;

export const PurchaseRequestSchema = z.object({
  userId: z.string().min(1),
  doc: z.string().min(1),
  /** PG payment token placeholder — payment precedes any download */
  paymentToken: z.string().optional(),
});
export type PurchaseRequest = z.infer<typeof PurchaseRequestSchema>;

export const DownloadRequestSchema = z.object({
  userId: z.string().min(1),
  doc: z.string().min(1),
});
export type DownloadRequest = z.infer<typeof DownloadRequestSchema>;

export const DownloadResponseSchema = z.object({
  container: ContainerSchema,
});
export type DownloadResponse = z.infer<typeof DownloadResponseSchema>;

export const OpenRequestSchema = z.object({
  copyId: z.string().min(1),
  token: TokenSchema,
});
export type OpenRequest = z.infer<typeof OpenRequestSchema>;

export const OpenSuccessSchema = z.object({
  viewStart: z.literal(true),
  /** the rotated token (T2) */
  token: TokenSchema,
  /** base64 content encryption key, released only on view-start */
  cek: z.string(),
  graceSeconds: z.number().int(),
});
export type OpenSuccess = z.infer<typeof OpenSuccessSchema>;

export const OpenFailureSchema = z.object({
  viewStart: z.literal(false),
  reason: z.string(),
});
export type OpenFailure = z.infer<typeof OpenFailureSchema>;

export const OpenResponseSchema = z.discriminatedUnion('viewStart', [
  OpenSuccessSchema,
  OpenFailureSchema,
]);
export type OpenResponse = z.infer<typeof OpenResponseSchema>;

export const NotifyEventSchema = z.object({
  type: z.enum(['opened', 'displaced']),
  copyId: z.string(),
  doc: z.string(),
  /** the new live token id after rotation — lets a holder self-filter its own opens */
  tid: z.string(),
  at: z.number().int(),
});
export type NotifyEvent = z.infer<typeof NotifyEventSchema>;
