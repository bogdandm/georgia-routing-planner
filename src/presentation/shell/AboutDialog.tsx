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

interface AboutDialogProps {
  readonly onClose: () => void;
  readonly open: boolean;
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

/** Public project identity and attributable third-party services. */
export function AboutDialog({ onClose, open }: AboutDialogProps) {
  if (!open) return null;

  return (
    <Paper
      role="dialog"
      aria-modal="false"
      aria-labelledby="about-panel-title"
      elevation={8}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
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
            <Typography variant="body2">
              <ExternalLink href="https://nominatim.openstreetmap.org/">
                Nominatim
              </ExternalLink>{' '}
              and{' '}
              <ExternalLink href="https://overpass-api.de/">Overpass API</ExternalLink>{' '}
              provide place and nearby-feature search.
            </Typography>
            <Typography variant="body2">
              <ExternalLink href="https://earth-search.aws.element84.com/v1">
                Earth Search STAC
              </ExternalLink>{' '}
              and <ExternalLink href="https://titiler.xyz/">TiTiler</ExternalLink>{' '}
              provide Sentinel-2 scene search and rendering.
            </Typography>
          </Stack>

          <Stack spacing={0.5}>
            <Typography component="h2" variant="subtitle2">
              Data sources
            </Typography>
            <Typography variant="body2">
              <ExternalLink href="https://openfreemap.org/">OpenFreeMap</ExternalLink>,{' '}
              <ExternalLink href="https://openmaptiles.org/">OpenMapTiles</ExternalLink>
              , and{' '}
              <ExternalLink href="https://www.openstreetmap.org/copyright">
                OpenStreetMap
              </ExternalLink>{' '}
              provide the vector map and map data.
            </Typography>
            <Typography variant="body2">
              <ExternalLink href="https://registry.opendata.aws/terrain-tiles/">
                AWS Open Data Mapzen Terrain Tiles
              </ExternalLink>{' '}
              provide elevation data, including Copernicus, USGS, NOAA, and regional
              sources.
            </Typography>
            <Typography variant="body2">
              <ExternalLink href="https://dataspace.copernicus.eu/">
                Copernicus Sentinel-2
              </ExternalLink>{' '}
              provides satellite imagery.
            </Typography>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 1.5, py: 1 }}>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Paper>
  );
}
