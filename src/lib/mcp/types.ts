import { z } from 'zod';

export const mcpTransportTypeSchema = z.enum(['stdio', 'streamable-http', 'sse']);

export const mcpServerSchema = z.object({
  name: z.string().min(1),
  type: mcpTransportTypeSchema.default('stdio'),
  command: z.string().optional(),
  url: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export type ManagedMcpServer = z.infer<typeof mcpServerSchema>;
export type McpTransportType = z.infer<typeof mcpTransportTypeSchema>;
