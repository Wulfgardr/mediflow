import { z } from 'zod';

export const LOCAL_UI_PROFILE = 'plugin_local_ui' as const;
export const LOCAL_UI_TOOL_ID = 'mediflow.local_ui.navigate.v1' as const;
export const LOCAL_UI_IPC_SCHEMA = 'mediflow.local-ui.navigation.v1' as const;
export const LOCAL_UI_RPC_MODE = 'navigation_inherited_child_ipc_v1' as const;
export const LOCAL_UI_INTENTS = ['search', 'identity', 'history', 'prescribing'] as const;
export const localUiArgumentsSchema = z.object({ intent: z.enum(LOCAL_UI_INTENTS) }).strict();
export type LocalUiIntent = typeof LOCAL_UI_INTENTS[number];
export const LOCAL_UI_OPERATION = Object.freeze({ operationId: LOCAL_UI_TOOL_ID,
  capabilityId: LOCAL_UI_TOOL_ID, serviceRef: 'mediflow.local-ui.navigation', maximumStage: 'read_only' as const });
export const LOCAL_UI_RESULT = Object.freeze({ status: 'continue_in_mediflow' as const });
export const LOCAL_UI_ERROR = 'MediFlow navigation unavailable.';
export const LOCAL_UI_CONTENT = 'continue_in_mediflow';
export const LOCAL_UI_BUS = 'mediflow.local-ui.navigation.v1';
