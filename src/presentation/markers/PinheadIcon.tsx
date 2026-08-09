import { Box } from '@mui/material';

export interface PinheadIconProps {
  readonly svg: string;
  readonly size?: number | string;
  readonly color?: string;
  readonly label?: string;
}

export function PinheadIcon({
  svg,
  size = '1em',
  color = 'currentColor',
  label,
}: PinheadIconProps) {
  return (
    <Box
      component="span"
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      sx={{
        display: 'inline-grid',
        placeItems: 'center',
        width: size,
        height: size,
        flex: '0 0 auto',
        color,
        lineHeight: 0,
        '& > svg': { width: '100%', height: '100%', fill: 'currentColor' },
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
