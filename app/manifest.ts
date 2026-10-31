import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Anchor ERP',
    short_name: 'Anchor',
    description: 'Anchor ERP - Premium Payment & Liquidity Management',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f6f5',
    theme_color: '#f4f6f5',
    orientation: 'portrait-primary',
    icons: [
      {
        src: '/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable'
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any'
      }
    ]
  }
}
