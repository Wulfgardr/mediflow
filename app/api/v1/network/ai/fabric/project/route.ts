import { handleNativeFabricHttp } from '@/lib/chatgpt-product/native-fabric-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request): Promise<Response> {
    return handleNativeFabricHttp(request, 'project');
}
export async function DELETE(request: Request): Promise<Response> {
    return handleNativeFabricHttp(request, 'project');
}
