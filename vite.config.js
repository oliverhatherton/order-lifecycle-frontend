import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the same build works whether it is served from a custom
// domain (https://demo.example.com/) or a project subpath
// (https://<user>.github.io/<repo>/). Combined with HashRouter this needs no
// per-deploy configuration. See .github/workflows/deploy.yml.
// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
})
