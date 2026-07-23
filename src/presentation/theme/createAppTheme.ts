import { createTheme } from '@mui/material/styles';

import { appColors } from '@/presentation/theme/appColors';

export function createAppTheme() {
  return createTheme({
    palette: {
      mode: 'light',
      primary: {
        main: appColors.brand.deepSpace,
        dark: '#011F2E',
        light: appColors.brand.blueGreen,
        contrastText: appColors.text.inverse,
      },
      secondary: {
        main: appColors.brand.tigerOrange,
        dark: appColors.status.warning,
        light: appColors.brand.amber,
      },
      info: { main: appColors.brand.blueGreen },
      warning: { main: appColors.brand.amber, dark: appColors.status.warning },
      error: { main: appColors.status.error },
      success: { main: appColors.status.success },
      background: {
        default: appColors.surface.canvas,
        paper: appColors.surface.panel,
      },
      text: {
        primary: appColors.text.primary,
        secondary: appColors.text.secondary,
      },
      divider: appColors.border.default,
      action: { selected: appColors.surface.selected },
    },
    typography: {
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      h6: { fontWeight: 750, letterSpacing: '-0.01em' },
      subtitle2: { fontWeight: 700 },
      button: { fontWeight: 650, textTransform: 'none' },
    },
    shape: { borderRadius: 10 },
    spacing: 8,
    components: {
      MuiButtonBase: {
        defaultProps: { disableRipple: false },
        styleOverrides: {
          root: {
            '&:focus-visible': {
              outline: `3px solid ${appColors.brand.tigerOrange}`,
              outlineOffset: 2,
            },
          },
        },
      },
      MuiAppBar: {
        styleOverrides: { root: { backgroundImage: 'none' } },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            minHeight: 36,
            transition:
              'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease, filter 120ms ease',
          },
          text: {
            '&:hover': {
              backgroundColor: 'color-mix(in srgb, currentColor 14%, transparent)',
            },
          },
          outlined: {
            '&:hover': {
              borderColor: appColors.border.strong,
              backgroundColor: 'color-mix(in srgb, currentColor 12%, transparent)',
            },
          },
          contained: {
            '&:hover': {
              filter: 'brightness(0.88)',
              boxShadow: '0 4px 10px rgba(2, 48, 71, 0.28)',
            },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: { borderRadius: 8 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minWidth: 52,
            minHeight: 58,
            marginInline: 6,
            marginBottom: 4,
            padding: '6px 4px',
            borderRadius: 10,
            color: 'rgba(255,255,255,0.72)',
            fontSize: '0.625rem',
            lineHeight: 1.1,
            textTransform: 'none',
            '&.Mui-selected': {
              color: appColors.text.inverse,
              backgroundColor: 'rgba(33,158,188,0.34)',
            },
            '& .MuiTab-iconWrapper': {
              marginBottom: '2px !important',
            },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
        },
      },
    },
  });
}
