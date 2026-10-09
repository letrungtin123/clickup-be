import { z } from "zod";

export const CursorQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const PageInfoSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean()
});

export const createCursorPageSchema = <Item extends z.ZodTypeAny>(item: Item) =>
  z.object({
    items: z.array(item),
    pageInfo: PageInfoSchema
  });

export type CursorQuery = z.infer<typeof CursorQuerySchema>;
export type PageInfo = z.infer<typeof PageInfoSchema>;
