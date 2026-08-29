import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.starfall.vector',
  appName: 'Starfall Vector',
  webDir: 'dist',
  android: {
    // Keep the WebView GPU-composited so Three.js gets a real WebGL context.
    allowMixedContent: false,
    backgroundColor: '#04030f',
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    StatusBar: {
      style: 'dark',
      backgroundColor: '#04030f',
      overlaysWebView: false,
    },
  },
};

export default config;
