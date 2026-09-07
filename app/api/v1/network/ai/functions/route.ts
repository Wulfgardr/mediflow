/* @Codex */
import { nativeConfigurationHttp } from '@/lib/native-ai-configuration-production';
export const runtime = 'nodejs';
export async function GET(request: Request) { return nativeConfigurationHttp.GET(request); }
export async function POST(request: Request) { return nativeConfigurationHttp.POST(request); }
