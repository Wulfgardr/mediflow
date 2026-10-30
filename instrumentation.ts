export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { installLoopbackIngress } = await import('./lib/security/loopback-ingress.mjs');
        installLoopbackIngress();
    }
}
