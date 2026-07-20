/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIMESTAMP__: string;
declare const __BUILD_MODE__: string;

interface ImportMetaEnv {
  readonly VITE_MAP_PROVIDER_CONFIGURATION?: string;
  readonly VITE_GEOCODING_PROVIDER_CONFIGURATION?: string;
}

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
