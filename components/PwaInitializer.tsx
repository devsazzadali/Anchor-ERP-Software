"use client";

import { useEffect } from "react";

export default function PwaInitializer() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      // Delay registration to ensure sw.js is directly served (not redirected)
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js', { scope: '/', updateViaCache: 'none' })
          .then((registration) => {
            console.log('PWA Service Worker registered:', registration.scope);
          })
          .catch((error) => {
            // Silently fail in dev — SW is optional for functionality
            if (process.env.NODE_ENV !== 'development') {
              console.warn('Service Worker registration failed:', error);
            }
          });
      });
    }
  }, []);

  return null;
}
