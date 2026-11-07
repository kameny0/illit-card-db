import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages repository path. Change this if your repository has another name.
  base: '/illit-card-db/',
})
