import { z } from 'zod';

export const mcpServerSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['stdio']).default('stdio'),
  command: z.string().min(1),
  env: z.record(z.string(), z.string()).optional(),
});

export type ManagedMcpServer = z.infer<typeof mcpServerSchema>;
