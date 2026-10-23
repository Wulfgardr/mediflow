import { z } from 'zod';

export const LOCAL_OPERATION_TOOL = 'mediflow.local_operation.v1';
export const LOCAL_OPERATION_SCHEMA = 'mediflow.local-operation.v1';
export const LOCAL_OPERATION_ERROR = 'MediFlow unavailable.';
export const LOCAL_OPERATION_RPC_MODE = 'local_operation_inherited_child_ipc_v1';
export const LOCAL_OPERATION_DESCRIPTOR = Object.freeze({ operationId: LOCAL_OPERATION_TOOL,
    capabilityId: LOCAL_OPERATION_TOOL, serviceRef: 'mediflow.local-operation', maximumStage: 'read_only' as const });
export const localOperationRefSchema = z.string().regex(/^lo_[0-9a-f]{32}$/);
export const localOperationInputSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('open') }).strict(),
    z.object({ action: z.literal('resume'), ref: localOperationRefSchema }).strict(),
    z.object({ action: z.literal('status'), ref: localOperationRefSchema }).strict(),
]);
export const localOperationResultSchema = z.object({
    schema: z.literal(LOCAL_OPERATION_SCHEMA),
    status: z.enum(['continue_in_mediflow', 'local_processing', 'local_result_available', 'unavailable']),
    ref: localOperationRefSchema.optional(),
}).strict();
export type LocalOperationInput = z.infer<typeof localOperationInputSchema>;
export type LocalOperationResult = z.infer<typeof localOperationResultSchema>;
export const LOCAL_OPERATION_TOOL_DESCRIPTOR = Object.freeze({
    name: LOCAL_OPERATION_TOOL,
    description: 'Continue an operation in the separate trusted MediFlow interface. Enter all values and confirmations there. Results are available only locally.',
    inputSchema: {
        type: 'object', properties: { action: { type: 'string', enum: ['open', 'resume', 'status'] }, ref: { type: 'string', pattern: '^lo_[0-9a-f]{32}$' } },
        required: ['action'], additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});
