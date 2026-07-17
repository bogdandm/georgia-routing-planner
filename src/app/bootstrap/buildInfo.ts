export interface BuildInfo {
  readonly appVersion: string;
  readonly commit: string;
  readonly timestamp: string;
  readonly mode: string;
}

export const buildInfo: BuildInfo = {
  appVersion: __APP_VERSION__,
  commit: __BUILD_COMMIT__,
  timestamp: __BUILD_TIMESTAMP__,
  mode: __BUILD_MODE__,
};
