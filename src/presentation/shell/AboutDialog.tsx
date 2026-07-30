import type { GeocodingProviderConfigurationResult } from '@/bootstrap/configuration/GeocodingProviderConfiguration';
import type { MapProviderConfigurationResult } from '@/bootstrap/configuration/MapProviderConfiguration';

import {
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
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

/** Public project identity and the provider configuration active in this deployment. */
export function AboutDialog({
  geocodingProviderConfiguration,
  mapProviderConfiguration,
  onClose,
  open,
  triggerRef,
}: AboutDialogProps) {
  const doneButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) doneButtonRef.current?.focus();
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
  const terrainAttribution =
    mapProviders === null
      ? null
      : mapProviders.terrain.attribution.replace(/<[^>]*>/gu, '');

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
        top: { xs: 16, sm: 24 },
        right: { xs: 16, sm: 24 },
        width: { xs: 'calc(100% - 32px)', sm: 440 },
        maxHeight: 'calc(100% - 32px)',
        overflowY: 'auto',
      }}
    >
      <DialogTitle id="about-panel-title" sx={{ px: 2, py: 1.5 }}>
        About Georgia Routing Planner
      </DialogTitle>
      <DialogContent sx={{ px: 2, py: 1.5 }}>
        <Stack spacing={2}>
          <Typography variant="body2">
            Created by{' '}
            <ExternalLink href="https://github.com/bogdandm">bogdandm</ExternalLink>.{' '}
            Source code:{' '}
            <ExternalLink href="https://github.com/bogdandm/georgia-routing-planner">
              GitHub repository
            </ExternalLink>
            .
          </Typography>

          <Stack spacing={0.5}>
            <Typography component="h2" variant="subtitle2">
              APIs
            </Typography>
            {geocoding === null ? (
              <Typography variant="body2">
                Place search is unavailable because its provider configuration is
                invalid.
              </Typography>
            ) : (
              <>
                <Typography variant="body2">
                  <ExternalLink href={geocoding.searchUrl}>
                    {new URL(geocoding.searchUrl).hostname}
                  </ExternalLink>{' '}
                  provides place search.
                </Typography>
                {geocoding.nearbyUrl === undefined ? null : (
                  <Typography variant="body2">
                    <ExternalLink href={geocoding.nearbyUrl}>
                      {new URL(geocoding.nearbyUrl).hostname}
                    </ExternalLink>{' '}
                    provides nearby-feature search.
                  </Typography>
                )}
              </>
            )}
            {mapProviders === null ? null : (
              <>
                <Typography variant="body2">
                  <ExternalLink href={mapProviders.satellite.searchUrl}>
                    {mapProviders.satellite.label}
                  </ExternalLink>{' '}
                  provides satellite scene search.
                </Typography>
                <Typography variant="body2">
                  <ExternalLink
                    href={originFor(mapProviders.satellite.renderer.tileUrlTemplate)}
                  >
                    {mapProviders.satellite.renderer.id}
                  </ExternalLink>{' '}
                  renders satellite scenes.
                </Typography>
              </>
            )}
          </Stack>

          <Stack spacing={0.5}>
            <Typography component="h2" variant="subtitle2">
              Data sources
            </Typography>
            {mapProviders === null ? (
              <Typography variant="body2">
                Map, elevation, and imagery sources are unavailable because their
                provider configuration is invalid.
              </Typography>
            ) : (
              <>
                <Typography variant="body2">
                  <ExternalLink href={originFor(mapProviders.vector.tileJsonUrl)}>
                    {mapProviders.vector.label}
                  </ExternalLink>{' '}
                  provides the vector map.
                </Typography>
                <Typography variant="body2">{vectorAttribution}</Typography>
                <Typography variant="body2">
                  <ExternalLink href={originFor(mapProviders.terrain.tileUrl)}>
                    {mapProviders.terrain.label}
                  </ExternalLink>{' '}
                  provides elevation data.
                </Typography>
                <Typography variant="body2">{terrainAttribution}</Typography>
                {mapProviders.terrain.id === 'aws-mapzen-terrarium' ? (
                  <Typography variant="body2">
                    This terrain source includes Copernicus, USGS, NOAA, and regional
                    elevation data.
                  </Typography>
                ) : null}
                <Typography variant="body2">
                  <ExternalLink href={mapProviders.satellite.searchUrl}>
                    {mapProviders.satellite.attribution}
                  </ExternalLink>{' '}
                  provides satellite imagery from the configured{' '}
                  {mapProviders.satellite.collections.L1C} and{' '}
                  {mapProviders.satellite.collections.L2A} collections.
                </Typography>
              </>
            )}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 1.5, py: 1 }}>
        <Button onClick={handleClose} ref={doneButtonRef}>
          Done
        </Button>
      </DialogActions>
    </Paper>
  );
}
