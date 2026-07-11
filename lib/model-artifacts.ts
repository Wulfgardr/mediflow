/* @Codex */
export function stripModelArtifacts(content: string): string {
    return content
        .replace(/<unused94>[\s\S]*?(<unused95>|$)/g, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/^Plan:\s*/gim, '')
        .replace(/\r/g, '')
        .trim();
}
