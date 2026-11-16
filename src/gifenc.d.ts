/** The part of gifenc's API the map GIF recorder uses; the package ships no types. */
declare module 'gifenc' {
  /** Up to 256 `[r, g, b]` colors. */
  export type GifPalette = number[][];

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
  ): GifPalette;

  /** One palette index per pixel. */
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
  ): Uint8Array;

  export interface GifEncoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: {
        readonly palette?: GifPalette;
        /** Milliseconds. */
        readonly delay?: number;
        /** 0 loops forever. */
        readonly repeat?: number;
      },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }

  export function GIFEncoder(): GifEncoder;
}
