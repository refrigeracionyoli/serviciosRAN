export function normalizeServiceType(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
}

export const DEFAULT_REPORT_EQUIPMENT_TYPE = 'MAQUINA HIELO'

export function normalizeReportServiceType(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\bENFRIADOR(?:ES)?\b/gi, DEFAULT_REPORT_EQUIPMENT_TYPE)
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildFallbackReportServiceType(
  value: string | null | undefined,
  equipmentType = DEFAULT_REPORT_EQUIPMENT_TYPE,
): string {
  const serviceType = normalizeReportServiceType(value)
  return serviceType.includes(' - ') ? serviceType : `${serviceType} - ${equipmentType}`
}

export function isInstallationServiceType(value: string | null | undefined): boolean {
  return normalizeServiceType(value).includes('INSTALACION')
}

export function isRetiroServiceType(value: string | null | undefined): boolean {
  return normalizeServiceType(value).includes('RETIRO')
}

export function isUrbanServiceType(value: string | null | undefined): boolean {
  return normalizeServiceType(value).includes('URBAN')
}

export function isInstallationOrRetiroServiceType(value: string | null | undefined): boolean {
  const normalized = normalizeServiceType(value)
  return normalized.includes('INSTALACION') || normalized.includes('RETIRO')
}
