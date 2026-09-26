import type { GeocodingProviderConfigurationResult } from '@/bootstrap/configuration/GeocodingProviderConfiguration';
import type { MapProviderConfigurationResult } from '@/bootstrap/configuration/MapProviderConfiguration';
import { weatherProviderConfiguration } from '@/bootstrap/configuration/WeatherProviderConfiguration';

import { Trans, useLingui } from '@lingui/react/macro';

import GitHubIcon from '@mui/icons-material/GitHub';
import CloseIcon from '@mui/icons-material/Close';
import {
  Box,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useRef, type RefObject } from 'react';

// Stable DOM identifier used by the dialog accessibility relationship.
// eslint-disable-next-line -- Stable DOM identifier, not user-visible copy.
const aboutPanelTitleId = 'about-panel-title';

interface AboutDialogProps {
  readonly onClose: () => void;
  readonly open: boolean;
  readonly geocodingProviderConfiguration: GeocodingProviderConfigurationResult;
  readonly mapProviderConfiguration: MapProviderConfigurationResult;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
}

interface ExternalLinkProps {
  readonly children: string;
  readonly href: string;
}

function ExternalLink({ children, href }: ExternalLinkProps) {
  return (
    <Link href={href} rel="noreferrer" target="_blank">
      {children}
    </Link>
  );
}

function originFor(endpoint: string): string {
  return new URL(endpoint).origin;
}

interface ServiceEntryLink {
  readonly href: string;
  readonly label: string;
}

interface ServiceEntryProps {
  readonly description: string;
  readonly details?: string | undefined;
  readonly links?: readonly ServiceEntryLink[] | undefined;
  readonly href: string;
  readonly title: string;
}

function ServiceEntry({ description, details, href, links, title }: ServiceEntryProps) {
  return (
    <Box>
      <ExternalLink href={href}>{title}</ExternalLink>
      <Typography variant="body2" color="text.secondary">
        {description}
      </Typography>
      {details === undefined ? null : (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 0.5 }}
        >
          {details}
        </Typography>
      )}
      {links === undefined ? null : (
        <Stack direction="row" spacing={1.5} sx={{ mt: 0.5 }}>
          {links.map((link) => (
            <ExternalLink key={link.href} href={link.href}>
              {link.label}
            </ExternalLink>
          ))}
        </Stack>
      )}
    </Box>
  );
}

/** Public project identity and the provider configuration active in this deployment. */
export function AboutDialog({
  geocodingProviderConfiguration,
  mapProviderConfiguration,
  onClose,
  open,
  triggerRef,
}: AboutDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { t } = useLingui();

  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  const handleClose = () => {
    onClose();
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  };

  if (!open) return null;

  const geocoding =
    geocodingProviderConfiguration.status === 'valid'
      ? geocodingProviderConfiguration.value
      : null;
  const mapProviders =
    mapProviderConfiguration.status === 'valid' ? mapProviderConfiguration.value : null;
  const vectorAttribution =
    mapProviders === null
      ? null
      : mapProviders.vector.attribution.replace(/<[^>]*>/gu, '');
  const detailVectorAttribution =
    mapProviders === null
      ? null
      : mapProviders.detailVector.attribution.replace(/<[^>]*>/gu, '');
  const vectorAttributionDetails: string[] = [];
  const displayedAttributionCredits = new Set<string>();
  for (const attribution of [vectorAttribution, detailVectorAttribution]) {
    if (attribution === null) continue;
    for (const part of attribution.split('·')) {
      const detail = part.trim();
      // Attribution normalization is locale-independent provider-data matching.
      /* eslint-disable -- Attribution normalization is locale-independent provider data. */
      const normalizedCredit = detail
        .toLocaleLowerCase()
        .replace(/^data from\s+/iu, '')
        .replace(/^©\s*/u, '');
      const credit = normalizedCredit.includes('openstreetmap')
        ? 'openstreetmap'
        : normalizedCredit;
      /* eslint-enable */
      if (credit.length === 0 || displayedAttributionCredits.has(credit)) continue;
      displayedAttributionCredits.add(credit);
      vectorAttributionDetails.push(detail);
    }
  }
  const terrainAttribution =
    mapProviders === null
      ? null
      : mapProviders.terrain.attribution.replace(/<[^>]*>/gu, '');
  const apiEntries: ServiceEntryProps[] = [];
  if (geocoding !== null) {
    apiEntries.push({
      description: t`Place search`,
      href: geocoding.searchUrl,
      title: new URL(geocoding.searchUrl).hostname,
    });
    if (geocoding.nearbyUrl !== undefined) {
      apiEntries.push({
        description: t`Nearby-feature search`,
        href: geocoding.nearbyUrl,
        title: new URL(geocoding.nearbyUrl).hostname,
      });
    }
  }
  apiEntries.push({
    description: t`Point weather forecast.`,
    href: weatherProviderConfiguration.forecastUrl,
    title: new URL(weatherProviderConfiguration.forecastUrl).hostname,
  });
  if (mapProviders !== null) {
    apiEntries.push(
      {
        description: t`Satellite scene search`,
        href: mapProviders.satellite.searchUrl,
        title: mapProviders.satellite.label,
      },
      {
        description: t`Satellite scene rendering`,
        href: originFor(mapProviders.satellite.renderer.tileUrlTemplate),
        title: new URL(originFor(mapProviders.satellite.renderer.tileUrlTemplate))
          .hostname,
      },
    );
  }

  const l1cCollection = mapProviders?.satellite.collections.L1C;
  const l2aCollection = mapProviders?.satellite.collections.L2A;
  const terrainCredits = terrainAttribution ?? '';
  const weatherModelName = weatherProviderConfiguration.models.ecmwf_ifs.displayName;
  const dataEntries: ServiceEntryProps[] = [];
  if (mapProviders !== null) {
    dataEntries.push(
      {
        description: t`Vector map`,
        details: vectorAttributionDetails.join(' · '),
        href: originFor(mapProviders.vector.tileJsonUrl),
        title: `${mapProviders.vector.label} + ${mapProviders.detailVector.label}`,
      },
      {
        description: t`Elevation data`,
        details:
          mapProviders.terrain.id === 'aws-mapzen-terrarium'
            ? t`${terrainCredits}. Includes Copernicus, USGS, NOAA, and regional elevation data.`
            : (terrainAttribution ?? undefined),
        href: originFor(mapProviders.terrain.tileUrl),
        title: mapProviders.terrain.label,
      },
      {
        description: t`Satellite imagery from ${l1cCollection} and ${l2aCollection}`,
        href: mapProviders.satellite.searchUrl,
        title: mapProviders.satellite.attribution,
      },
    );

    for (const satelliteBasemap of [
      mapProviders.satelliteBasemap,
      mapProviders.bingSatelliteBasemap,
      mapProviders.esriSatelliteBasemap,
    ]) {
      const tileUrl = satelliteBasemap.tileUrls[0];
      if (tileUrl === undefined) continue;
      dataEntries.push({
        description: t`Satellite basemap`,
        details: satelliteBasemap.attribution.replace(/<[^>]*>/gu, ''),
        href: originFor(tileUrl),
        title: satelliteBasemap.label,
      });
    }

    const naprOrthophotoTileUrl =
      mapProviders.naprOrthophoto.sources.national2016To2017.tileUrls[0];
    if (naprOrthophotoTileUrl !== undefined) {
      dataEntries.push({
        description: t`Georgian orthophoto mosaic`,
        details: mapProviders.naprOrthophoto.attribution.replace(/<[^>]*>/gu, ''),
        href: originFor(naprOrthophotoTileUrl),
        title: mapProviders.naprOrthophoto.label,
      });
    }
  }
  dataEntries.push({
    description: t`Weather forecast data`,
    details: t`Deterministic 9 km model forecast; not a measured weather-station observation.`,
    href: weatherProviderConfiguration.attributionUrl,
    links: [
      {
        href: weatherProviderConfiguration.licenseUrl,
        label: t`Data licence`,
      },
    ],
    title: t`${weatherModelName} via Open-Meteo`,
  });

  return (
    <Paper
      role="dialog"
      aria-modal={false}
      aria-labelledby={aboutPanelTitleId}
      elevation={8}
      onKeyDown={(event) => {
        if (event.key === 'Escape') handleClose();
      }}
      sx={{
        position: 'fixed',
        zIndex: 10,
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: { xs: 'calc(100% - 32px)', sm: 640 },
        maxWidth: 'calc(100% - 32px)',
        maxHeight: 'calc(100% - 32px)',
        overflowY: 'auto',
      }}
    >
      <DialogTitle
        id={aboutPanelTitleId}
        sx={(theme) => ({
          px: 2,
          py: 1.5,
          position: 'relative',
          pr: 6,
          [theme.breakpoints.up('sm')]: { px: 6, py: 4, pr: 14 },
        })}
      >
        <Trans>About Trail Planner</Trans>
        <IconButton
          aria-label={t`Close site information`}
          onClick={handleClose}
          ref={closeButtonRef}
          size="small"
          sx={(theme) => ({
            position: 'absolute',
            right: 12,
            top: 12,
            [theme.breakpoints.up('sm')]: { right: 32, top: 32 },
          })}
        >
          <CloseIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </DialogTitle>
      <DialogContent
        sx={(theme) => ({
          px: 2,
          pt: 0,
          pb: 1.5,
          [theme.breakpoints.up('sm')]: { px: 6, pb: 4 },
        })}
      >
        <Stack spacing={2}>
          <Stack spacing={0.5}>
            <Typography variant="body2">
              <Trans>
                Created by <strong>Bogdan Kalashnikov</strong> (bogdandm).
              </Trans>
            </Typography>
            <Link
              href="https://github.com/bogdandm/georgia-routing-planner"
              rel="noreferrer"
              target="_blank"
              sx={{
                alignItems: 'center',
                display: 'inline-flex',
                gap: 0.75,
                width: 'fit-content',
              }}
            >
              <GitHubIcon sx={{ fontSize: 20 }} />
              <Trans>GitHub repository</Trans>
            </Link>
          </Stack>

          <Stack spacing={1}>
            <Typography component="h2" variant="subtitle2">
              <Trans>APIs</Trans>
            </Typography>
            {geocoding === null ? (
              <Typography variant="body2" color="text.secondary">
                <Trans>
                  Place search is unavailable because its provider configuration is
                  invalid.
                </Trans>
              </Typography>
            ) : null}
            {mapProviders === null ? (
              <Typography variant="body2" color="text.secondary">
                <Trans>
                  Satellite search is unavailable because its provider configuration is
                  invalid.
                </Trans>
              </Typography>
            ) : null}
            <Stack spacing={1.25}>
              {apiEntries.map((entry) => (
                <ServiceEntry key={entry.href} {...entry} />
              ))}
            </Stack>
          </Stack>

          <Stack spacing={1}>
            <Typography component="h2" variant="subtitle2">
              <Trans>Data sources</Trans>
            </Typography>
            {mapProviders === null ? (
              <Typography variant="body2" color="text.secondary">
                <Trans>
                  Map, elevation, and imagery sources are unavailable because their
                  provider configuration is invalid.
                </Trans>
              </Typography>
            ) : (
              <Stack spacing={1.25}>
                {dataEntries.map((entry) => (
                  <ServiceEntry key={entry.href} {...entry} />
                ))}
              </Stack>
            )}
          </Stack>
        </Stack>
      </DialogContent>
    </Paper>
  );
}
