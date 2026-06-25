export function normalizeServiceType(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
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
