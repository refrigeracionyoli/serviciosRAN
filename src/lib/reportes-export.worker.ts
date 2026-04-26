import {
  buildWeeklyReportBundleFromBundles,
  type ServiceEvidenceExportBundle,
  type WeeklyReportExportInput,
  type WeeklyReportProgress,
} from '@/lib/reportes-export'

type WorkerRequest =
  | {
      type: 'build'
      input: WeeklyReportExportInput
      bundles: ServiceEvidenceExportBundle[]
    }
  | {
      type: 'cancel'
    }

type WorkerResponse =
  | {
      type: 'progress'
      progress: WeeklyReportProgress
    }
  | {
      type: 'done'
      filename: string
      totalServicios: number
      buffer: ArrayBuffer
    }
  | {
      type: 'error'
      name?: string
      message: string
    }

const workerScope = self as unknown as {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
}

let activeAbortController: AbortController | null = null

workerScope.onmessage = (event) => {
  const message = event.data

  if (message.type === 'cancel') {
    activeAbortController?.abort()
    return
  }

  if (activeAbortController) {
    activeAbortController.abort()
  }

  activeAbortController = new AbortController()
  const abortController = activeAbortController

  void buildWeeklyReportBundleFromBundles(message.input, message.bundles, {
    signal: abortController.signal,
    onProgress: (progress) => {
      workerScope.postMessage({ type: 'progress', progress })
    },
  })
    .then(async (result) => {
      const buffer = await result.blob.arrayBuffer()
      workerScope.postMessage({
        type: 'done',
        filename: result.filename,
        totalServicios: result.totalServicios,
        buffer,
      }, [buffer])
    })
    .catch((error: unknown) => {
      workerScope.postMessage({
        type: 'error',
        name: error instanceof Error ? error.name : undefined,
        message: error instanceof Error ? error.message : 'No se pudo generar el reporte semanal.',
      })
    })
    .finally(() => {
      if (activeAbortController === abortController) {
        activeAbortController = null
      }
    })
}
