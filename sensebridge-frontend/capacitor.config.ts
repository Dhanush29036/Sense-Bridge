import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'io.sensebridge.app',
    appName: 'SenseBridge',
    webDir: 'dist',
    server: {
        // In production remove this and let the app load from dist/
        androidScheme: 'https',
    },
    plugins: {
        // Geolocation permissions
        Geolocation: {
            requestPermissions: true,
        },
    },
};

export default config;
