import type { GeocodingProviderConfigurationResult } from '@/bootstrap/configuration/GeocodingProviderConfiguration';
import type { MapProviderConfigurationResult } from '@/bootstrap/configuration/MapProviderConfiguration';

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

interface ServiceEntryProps {
  readonly description: string;
  readonly details?: string | undefined;
  readonly href: string;
  readonly title: string;
}

function ServiceEntry({ description, details, href, title }: ServiceEntryProps) {
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
      const normalizedCredit = detail
        .toLocaleLowerCase()
        .replace(/^data from\s+/iu, '')
        .replace(/^©\s*/u, '');
      const credit = normalizedCredit.includes('openstreetmap')
        ? 'openstreetmap'
        : normalizedCredit;
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
      description: 'Place search',
      href: geocoding.searchUrl,
      title: new URL(geocoding.searchUrl).hostname,
    });
    if (geocoding.nearbyUrl !== undefined) {
      apiEntries.push({
        description: 'Nearby-feature search',
        href: geocoding.nearbyUrl,
        title: new URL(geocoding.nearbyUrl).hostname,
      });
    }
  }
  if (mapProviders !== null) {
    apiEntries.push(
      {
        description: 'Satellite scene search',
        href: mapProviders.satellite.searchUrl,
        title: mapProviders.satellite.label,
      },
      {
        description: 'Satellite scene rendering',
        href: originFor(mapProviders.satellite.renderer.tileUrlTemplate),
        title: new URL(originFor(mapProviders.satellite.renderer.tileUrlTemplate))
          .hostname,
      },
    );
  }

  const dataEntries: ServiceEntryProps[] = [];
  if (mapProviders !== null) {
    dataEntries.push(
      {
        description: 'Vector map',
        details: vectorAttributionDetails.join(' · '),
        href: originFor(mapProviders.vector.tileJsonUrl),
        title: `${mapProviders.vector.label} + ${mapProviders.detailVector.label}`,
      },
      {
        description: 'Elevation data',
        details:
          mapProviders.terrain.id === 'aws-mapzen-terrarium'
            ? `${terrainAttribution ?? ''}. Includes Copernicus, USGS, NOAA, and regional elevation data.`
            : (terrainAttribution ?? undefined),
        href: originFor(mapProviders.terrain.tileUrl),
        title: mapProviders.terrain.label,
      },
      {
        description: `Satellite imagery from ${mapProviders.satellite.collections.L1C} and ${mapProviders.satellite.collections.L2A}`,
        href: mapProviders.satellite.searchUrl,
        title: mapProviders.satellite.attribution,
      },
    );
  }

  return (
    <Paper
      role="dialog"
      aria-modal="false"
      aria-labelledby="about-panel-title"
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
        width: { xs: 'calc(100% - 32px)', sm: 440 },
        maxHeight: 'calc(100% - 32px)',
        overflowY: 'auto',
      }}
    >
      <DialogTitle
        id="about-panel-title"
        sx={{ px: 2, py: 1.5, position: 'relative', pr: 6 }}
      >
        About Trail Planner
        <IconButton
          aria-label="Close site information"
          onClick={handleClose}
          ref={closeButtonRef}
          size="small"
          sx={{ position: 'absolute', right: 12, top: 12 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ px: 2, py: 1.5 }}>
        <Stack spacing={2}>
          <Stack spacing={0.5}>
            <Typography variant="body2">
              Created by <strong>Bogdan Kalashnikov</strong> (bogdandm).
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
              <GitHubIcon fontSize="small" />
              GitHub repository
            </Link>
          </Stack>

          <Stack spacing={1}>
            <Typography component="h2" variant="subtitle2">
              APIs
            </Typography>
            {geocoding === null ? (
              <Typography variant="body2" color="text.secondary">
                Place search is unavailable because its provider configuration is
                invalid.
              </Typography>
            ) : null}
            {mapProviders === null ? (
              <Typography variant="body2" color="text.secondary">
                Satellite search is unavailable because its provider configuration is
                invalid.
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
              Data sources
            </Typography>
            {mapProviders === null ? (
              <Typography variant="body2" color="text.secondary">
                Map, elevation, and imagery sources are unavailable because their
                provider configuration is invalid.
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
