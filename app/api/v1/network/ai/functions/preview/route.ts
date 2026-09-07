/* @Codex */
import { nativeConfigurationHttp } from '@/lib/native-ai-configuration-production';
export const runtime = 'nodejs';
export async function POST(request: Request) { return nativeConfigurationHttp.PREVIEW(request); }
