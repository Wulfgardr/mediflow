import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'MediFlow',
        short_name: 'MediFlow',
        start_url: '/',
        display: 'standalone',
        background_color: '#e8eaee',
        theme_color: '#ffffff',
        icons: [192, 512].flatMap(size => [
            { src: `/brand/mediflow/punto-giorno-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' as const },
            { src: `/brand/mediflow/punto-giorno-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'maskable' as const },
        ]),
    };
}
