import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'
import { App } from './App'
import './index.css'

const CHUNK_RELOAD_STORAGE_KEY = 'ran.chunk-reload-attempted'

function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error
    ? `${error.name} ${error.message}`
    : String(error ?? '')

  return /valid JavaScript MIME type|dynamically imported module|module script|Failed to fetch/i.test(message)
}

function reloadForFreshBuild() {
  if (sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY) === 'true') return

  sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, 'true')
  window.location.reload()
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  reloadForFreshBuild()
})

window.addEventListener('unhandledrejection', (event) => {
  if (isStaleChunkError(event.reason)) {
    event.preventDefault()
    reloadForFreshBuild()
  }
})

window.addEventListener('error', (event) => {
  if (isStaleChunkError(event.error ?? event.message)) {
    event.preventDefault()
    reloadForFreshBuild()
  }
})

window.addEventListener('load', () => {
  sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY)
})

const root = document.getElementById('root')
if (!root) throw new Error('No se encontró el elemento #root')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
