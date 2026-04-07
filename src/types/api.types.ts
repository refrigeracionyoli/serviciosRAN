// ─────────────────────────────────────────────────────────────
// EDGE FUNCTION — R2 Presigned URLs
// ─────────────────────────────────────────────────────────────

export interface PresignedPutRequest {
  servicioId: number
  filename: string
  contentType: string
}

export interface PresignedPutResponse {
  uploadUrl: string
  r2Key: string
}

export interface PresignedGetRequest {
  r2Key: string
}

export interface PresignedGetResponse {
  downloadUrl: string
}

// ─────────────────────────────────────────────────────────────
// EDGE FUNCTION — Generación de Excel
// ─────────────────────────────────────────────────────────────

export interface GenerarReporteRequest {
  semana: string       // formato S0426
  fechaInicio: string  // YYYY-MM-DD
  fechaFin: string     // YYYY-MM-DD
}

export interface GenerarReporteResponse {
  url?: string
  blob?: Blob
  filename: string
}

export interface GenerarEvidenciaRequest {
  servicioId: number
}

export interface GenerarEvidenciaResponse {
  url?: string
  blob?: Blob
  filename: string
}

// ─────────────────────────────────────────────────────────────
// ERRORES
// ─────────────────────────────────────────────────────────────

export interface ApiError {
  message: string
  code?: string
  status?: number
}
