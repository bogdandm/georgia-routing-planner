import { createTheme } from '@mui/material/styles';

export function createAppTheme() {
  return createTheme({
    palette: {
      mode: 'light',
      primary: { main: '#1f5b45', dark: '#143d2e', light: '#4c806b' },
      secondary: { main: '#b66a2c' },
      background: { default: '#eef1eb', paper: '#fbfcf8' },
    },
    typography: {
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      h6: { fontWeight: 700, letterSpacing: '0.01em' },
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
              outline: '3px solid #d58442',
              outlineOffset: 2,
            },
          },
        },
      },
      MuiAppBar: {
        styleOverrides: { root: { backgroundImage: 'none' } },
      },
    },
  });
}
