import type { Prisma } from '@prisma/client';

export type RoutingJurisdictionZone = {
  id?: string | null;
  name?: string | null;
  zoneType?: string | null;
  country?: string | null;
  state?: string | null;
  lga?: string | null;
  active?: boolean | null;
};

export type RoutingOrganizationLocality = {
  country?: string | null;
  state?: string | null;
  lga?: string | null;
  address?: string | null;
  jurisdictionZones?: RoutingJurisdictionZone[];
};

export type RoutingLocationInput = {
  location?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  locationLandmark?: string | null;
  description?: string | null;
  title?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type RoutingJurisdictionMatch = {
  configured: boolean;
  matched: boolean;
  source: 'JURISDICTION_ZONE' | 'LEGACY_ORGANIZATION_LOCALITY' | 'NONE';
  level: 'LGA' | 'STATE' | 'COUNTRY' | 'NONE';
  comparableLocationAvailable: boolean;
  locationText: string;
  diagnosticText: string;
  jurisdictionAreas: string[];
  configuredZones: Array<{
    id?: string | null;
    name?: string | null;
    zoneType?: string | null;
    country?: string | null;
    state?: string | null;
    lga?: string | null;
    active?: boolean | null;
  }>;
  legacyFallback: {
    active: boolean;
    country?: string | null;
    state?: string | null;
    lga?: string | null;
    address?: string | null;
  };
  reason:
    | 'MATCHED_LGA'
    | 'MATCHED_STATE'
    | 'MATCHED_COUNTRY'
    | 'NO_JURISDICTION_CONFIGURED'
    | 'NO_COMPARABLE_LOCATION_TEXT'
    | 'JURISDICTION_MISMATCH';
};

export function activeRoutingJurisdictionZones(
  zones?: RoutingJurisdictionZone[] | null,
) {
  return (zones ?? []).filter((zone) => zone.active !== false);
}

export function evaluateRoutingJurisdiction(
  organization: RoutingOrganizationLocality,
  report?: RoutingLocationInput | null,
): RoutingJurisdictionMatch {
  const activeZones = activeRoutingJurisdictionZones(
    organization.jurisdictionZones,
  );
  const locationText = routingLocationText(report);
  const diagnosticText = routingDiagnosticLocationText(report);
  const comparableLocationAvailable = locationText.length > 0;
  const configuredZones = activeZones.map((zone) => ({
    id: zone.id,
    name: clean(zone.name),
    zoneType: clean(zone.zoneType),
    country: clean(zone.country),
    state: clean(zone.state),
    lga: clean(zone.lga),
    active: zone.active,
  }));

  if (activeZones.length > 0) {
    const match = firstMatchedZone(activeZones, locationText);
    return {
      configured: true,
      matched: Boolean(match) && comparableLocationAvailable,
      source: 'JURISDICTION_ZONE',
      level: match?.level ?? strongestConfiguredLevel(activeZones),
      comparableLocationAvailable,
      locationText,
      diagnosticText,
      jurisdictionAreas: zoneJurisdictionAreas(activeZones),
      configuredZones,
      legacyFallback: legacyFallbackSummary(organization, false),
      reason: match
        ? match.reason
        : comparableLocationAvailable
          ? 'JURISDICTION_MISMATCH'
          : 'NO_COMPARABLE_LOCATION_TEXT',
    };
  }

  const legacy = legacyFallbackZone(organization);
  if (!legacy) {
    return {
      configured: false,
      matched: false,
      source: 'NONE',
      level: 'NONE',
      comparableLocationAvailable,
      locationText,
      diagnosticText,
      jurisdictionAreas: [],
      configuredZones,
      legacyFallback: legacyFallbackSummary(organization, false),
      reason: 'NO_JURISDICTION_CONFIGURED',
    };
  }

  const match = matchZone(legacy, locationText);
  return {
    configured: true,
    matched: Boolean(match) && comparableLocationAvailable,
    source: 'LEGACY_ORGANIZATION_LOCALITY',
    level: match?.level ?? strongestConfiguredLevel([legacy]),
    comparableLocationAvailable,
    locationText,
    diagnosticText,
    jurisdictionAreas: zoneJurisdictionAreas([legacy]),
    configuredZones,
    legacyFallback: legacyFallbackSummary(organization, true),
    reason: match
      ? match.reason
      : comparableLocationAvailable
        ? 'JURISDICTION_MISMATCH'
        : 'NO_COMPARABLE_LOCATION_TEXT',
  };
}

export function routingLocationText(report?: RoutingLocationInput | null) {
  return normalizeLocationText([
    report?.location,
    report?.locationName,
    report?.locationAddress,
    report?.locationLandmark,
  ]);
}

function routingDiagnosticLocationText(report?: RoutingLocationInput | null) {
  return normalizeLocationText([
    report?.location,
    report?.locationName,
    report?.locationAddress,
    report?.locationLandmark,
    report?.description,
    report?.title,
  ]);
}

function firstMatchedZone(
  zones: RoutingJurisdictionZone[],
  locationText: string,
) {
  for (const zone of zones) {
    const match = matchZone(zone, locationText);
    if (match) return match;
  }
  return null;
}

function matchZone(zone: RoutingJurisdictionZone, locationText: string) {
  if (!locationText) return null;
  const country = clean(zone.country);
  const state = clean(zone.state);
  const lga = clean(zone.lga);

  if (lga) {
    if (!containsPlace(locationText, lga)) return null;
    return { level: 'LGA' as const, reason: 'MATCHED_LGA' as const };
  }

  if (state) {
    if (!containsPlace(locationText, state)) return null;
    return { level: 'STATE' as const, reason: 'MATCHED_STATE' as const };
  }

  if (country && containsPlace(locationText, country)) {
    return { level: 'COUNTRY' as const, reason: 'MATCHED_COUNTRY' as const };
  }

  return null;
}

function legacyFallbackZone(
  organization: RoutingOrganizationLocality,
): RoutingJurisdictionZone | null {
  if (clean(organization.lga) || clean(organization.state)) {
    return {
      name: 'Legacy organization locality',
      zoneType: clean(organization.lga) ? 'LGA' : 'STATE',
      country: clean(organization.country),
      state: clean(organization.state),
      lga: clean(organization.lga),
      active: true,
    };
  }
  return null;
}

function strongestConfiguredLevel(zones: RoutingJurisdictionZone[]) {
  if (zones.some((zone) => clean(zone.lga))) return 'LGA' as const;
  if (zones.some((zone) => clean(zone.state))) return 'STATE' as const;
  if (zones.some((zone) => clean(zone.country))) return 'COUNTRY' as const;
  return 'NONE' as const;
}

function zoneJurisdictionAreas(zones: RoutingJurisdictionZone[]) {
  return collectStringList(
    zones.flatMap((zone) => [zone.lga, zone.state, zone.country]),
  );
}

function legacyFallbackSummary(
  organization: RoutingOrganizationLocality,
  active: boolean,
) {
  return {
    active,
    country: clean(organization.country),
    state: clean(organization.state),
    lga: clean(organization.lga),
    address: clean(organization.address),
  };
}

function containsPlace(locationText: string, place: string) {
  const normalizedPlace = normalizeLocationText([place]);
  if (!normalizedPlace) return false;
  const pattern = new RegExp(
    `(^|\\s)${escapeRegExp(normalizedPlace)}($|\\s)`,
    'i',
  );
  return pattern.test(locationText);
}

function normalizeLocationText(values: Array<string | null | undefined>) {
  return values
    .map((value) => clean(value))
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase()
    .replace(/federal capital territory/g, 'fct')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clean(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function collectStringList(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type JurisdictionZoneInput = {
  name?: string;
  zoneType?: string;
  country?: string | null;
  state?: string | null;
  lga?: string | null;
  active?: boolean;
  metadata?: Prisma.InputJsonValue;
};
