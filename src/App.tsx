import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { Toaster } from '@/components/ui/toaster'
import { OfflineBanner } from '@/components/shared/OfflineBanner'

export function App() {
  return (
    <>
      <RouterProvider router={router} />
      <OfflineBanner />
      <Toaster />
    </>
  )
}
