import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// NOTE: Camera access requires HTTPS in most mobile browsers.
// For a self-signed TLS cert on localhost, install and add:
//   npm install -D @vitejs/plugin-basic-ssl
//   import basicSsl from '@vitejs/plugin-basic-ssl'
//   plugins: [react(), basicSsl()]

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
    // host: true,  // Uncomment to expose on LAN (needed for mobile testing)
  },
});
