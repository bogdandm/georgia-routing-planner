import {
  encodeTerrariumElevation,
  type DecodedTerrariumTile,
  type TerrariumFilterPolicy,
  type TerrariumTileGrid,
} from '../../src/infrastructure/elevation/TerrariumDemFilter';

export const terrariumFilterPolicy: TerrariumFilterPolicy = {
  minimumElevationMeters: -500,
  maximumElevationMeters: 9_000,
  sentinelElevationsMeters: [-32_768, -9_999],
  spikeThresholdMeters: 500,
  negativeSpikeThresholdMeters: 300,
  maximumNeighborMadMeters: 80,
  minimumConsensusNeighbors: 5,
  maximumSpikeSupportNeighbors: 1,
  cacheSize: 8,
};

export interface TerrariumFilterFixture {
  readonly name: string;
  readonly policy: TerrariumFilterPolicy;
  readonly createGrid: () => TerrariumTileGrid;
}

export type TerrariumBenchmarkFixture = TerrariumFilterFixture;

type ElevationAt = (x: number, y: number) => number;
type MutableTerrariumTileGrid = [
  [
    DecodedTerrariumTile | null,
    DecodedTerrariumTile | null,
    DecodedTerrariumTile | null,
  ],
  [DecodedTerrariumTile | null, DecodedTerrariumTile, DecodedTerrariumTile | null],
  [
    DecodedTerrariumTile | null,
    DecodedTerrariumTile | null,
    DecodedTerrariumTile | null,
  ],
];

const neighborCoordinates = [
  [1, 1],
  [2, 1],
  [3, 1],
  [1, 2],
  [3, 2],
  [1, 3],
  [2, 3],
  [3, 3],
] as const;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_00_00_00_00;
  };
}

export function createTerrariumTile(
  width: number,
  height: number,
  elevationAt: ElevationAt,
): DecodedTerrariumTile {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setTerrariumPixel({ width, height, data }, x, y, elevationAt(x, y));
    }
  }
  return { width, height, data };
}

export function setTerrariumPixel(
  tile: DecodedTerrariumTile,
  x: number,
  y: number,
  elevationMeters: number,
  alpha = 255,
): void {
  const [red, green, blue] = encodeTerrariumElevation(elevationMeters);
  const offset = (y * tile.width + x) * 4;
  tile.data[offset] = red;
  tile.data[offset + 1] = green;
  tile.data[offset + 2] = blue;
  tile.data[offset + 3] = alpha;
}

export function createCompleteTerrariumGrid(
  width: number,
  height: number,
  elevationAt: ElevationAt,
): MutableTerrariumTileGrid {
  const makeTile = () => createTerrariumTile(width, height, elevationAt);
  return [
    [makeTile(), makeTile(), makeTile()],
    [makeTile(), makeTile(), makeTile()],
    [makeTile(), makeTile(), makeTile()],
  ];
}

function fixture(
  name: string,
  width: number,
  height: number,
  elevationAt: ElevationAt,
  mutate?: (grid: MutableTerrariumTileGrid) => void,
  policy: TerrariumFilterPolicy = terrariumFilterPolicy,
): TerrariumFilterFixture {
  return {
    name,
    policy,
    createGrid: () => {
      const grid = createCompleteTerrariumGrid(width, height, elevationAt);
      mutate?.(grid);
      return grid;
    },
  };
}

function centerThresholdFixture(
  name: string,
  centerElevation: number,
  neighborElevations: readonly number[],
  policy: TerrariumFilterPolicy = terrariumFilterPolicy,
): TerrariumFilterFixture {
  return fixture(
    name,
    5,
    5,
    () => 1_000,
    (grid) => {
      const center = grid[1][1];
      setTerrariumPixel(center, 2, 2, centerElevation);
      for (let index = 0; index < neighborCoordinates.length; index += 1) {
        const coordinate = neighborCoordinates[index];
        const elevation = neighborElevations[index];
        if (coordinate !== undefined && elevation !== undefined) {
          setTerrariumPixel(center, coordinate[0], coordinate[1], elevation);
        }
      }
    },
    policy,
  );
}

function corruptedFixture(
  name: string,
  width: number,
  height: number,
  elevationAt: ElevationAt,
  corruptionCount: number,
  seed: number,
): TerrariumFilterFixture {
  return fixture(name, width, height, elevationAt, (grid) => {
    const center = grid[1][1];
    const random = seededRandom(seed);
    const selected = new Set<number>();
    while (selected.size < corruptionCount) {
      selected.add(Math.floor(random() * width * height));
    }
    let corruptionIndex = 0;
    for (const index of selected) {
      const x = index % width;
      const y = Math.floor(index / width);
      const kind = corruptionIndex % 4;
      if (kind === 0) setTerrariumPixel(center, x, y, 0, 0);
      else if (kind === 1) setTerrariumPixel(center, x, y, -32_768);
      else if (kind === 2) setTerrariumPixel(center, x, y, -700);
      else setTerrariumPixel(center, x, y, 8_000);
      corruptionIndex += 1;
    }
  });
}

const smooth: ElevationAt = (x, y) => 1_000 + 0.5 * x + 0.25 * y;
const rugged: ElevationAt = (x, y) =>
  1_200 + 3 * x + 2 * y + 120 * Math.sin(x / 11) * Math.cos(y / 13);

export function createTerrariumParityFixtures(): readonly TerrariumFilterFixture[] {
  const quantum = 1 / 256;
  const noisyRandom = seededRandom(0x51_15_ee_d5);
  const noise = new Float64Array(17 * 13);
  for (let index = 0; index < noise.length; index += 1) {
    noise[index] = (noisyRandom() - 0.5) * 8;
  }

  const fixtures: TerrariumFilterFixture[] = [
    fixture('zero-width tile', 0, 3, () => 1_000),
    fixture('zero-height tile', 3, 0, () => 1_000),
    fixture('one pixel', 1, 1, () => 1_000),
    fixture('small square', 3, 3, smooth),
    fixture('non-square', 9, 4, smooth),
    fixture('flat no repair', 16, 16, () => 1_000),
    fixture('smooth gradient no repair', 31, 17, smooth),
    fixture(
      'seeded few-metre noise',
      17,
      13,
      (x, y) => 1_200 + (noise[y * 17 + x] ?? 0),
    ),
    fixture('seeded mountain relief', 32, 24, rugged),
    fixture('stable cliff', 11, 9, (x) => (x < 5 ? 500 : 1_200)),
    fixture('stable narrow ridge', 11, 9, (_x, y) => (y === 4 ? 1_800 : 1_000)),
    centerThresholdFixture('isolated positive spike', 1_700, Array(8).fill(1_000)),
    centerThresholdFixture('isolated negative spike', 600, Array(8).fill(1_000)),
    fixture(
      'severe downward strand',
      7,
      7,
      () => 2_650,
      (grid) => {
        setTerrariumPixel(grid[1][1], 3, 2, -140);
        setTerrariumPixel(grid[1][1], 3, 3, -140);
        setTerrariumPixel(grid[1][1], 3, 4, -140);
      },
    ),
    fixture(
      'mixed lake corruption',
      5,
      5,
      () => 1_000,
      (grid) => {
        const center = grid[1][1];
        setTerrariumPixel(center, 1, 1, 445.1);
        setTerrariumPixel(center, 2, 1, 2_673.4);
        setTerrariumPixel(center, 3, 1, 2_672.9);
        setTerrariumPixel(center, 1, 2, 1_372.2);
        setTerrariumPixel(center, 2, 2, -1_695.6);
        setTerrariumPixel(center, 3, 2, 2_673.2);
        setTerrariumPixel(center, 1, 3, 2_299.3);
        setTerrariumPixel(center, 2, 3, 1_434.9);
        setTerrariumPixel(center, 3, 3, 570.5);
      },
    ),
    centerThresholdFixture(
      'multiple neighbors support extreme',
      1_600,
      [1_600, 1_600, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000],
    ),
    fixture(
      'full bad scanline',
      16,
      9,
      () => 1_100,
      (grid) => {
        for (let x = 0; x < 16; x += 1) setTerrariumPixel(grid[1][1], x, 4, -700);
      },
    ),
    fixture(
      'transparent no-data',
      5,
      5,
      () => 1_000,
      (grid) => {
        setTerrariumPixel(grid[1][1], 2, 2, 0, 0);
      },
    ),
    fixture(
      'every configured sentinel',
      5,
      5,
      () => 1_000,
      (grid) => {
        setTerrariumPixel(grid[1][1], 1, 2, -32_768);
        setTerrariumPixel(grid[1][1], 3, 2, -9_999);
      },
    ),
    fixture(
      'below and above physical limits',
      5,
      5,
      () => 1_000,
      (grid) => {
        setTerrariumPixel(grid[1][1], 1, 2, -500 - quantum);
        setTerrariumPixel(grid[1][1], 3, 2, 9_000 + quantum);
      },
    ),
    centerThresholdFixture(
      'positive residual below threshold',
      1_500 - quantum,
      Array(8).fill(1_000),
    ),
    centerThresholdFixture(
      'positive residual at threshold',
      1_500,
      Array(8).fill(1_000),
    ),
    centerThresholdFixture(
      'positive residual above threshold',
      1_500 + quantum,
      Array(8).fill(1_000),
    ),
    centerThresholdFixture(
      'negative residual below threshold',
      700 + quantum,
      Array(8).fill(1_000),
    ),
    centerThresholdFixture('negative residual at threshold', 700, Array(8).fill(1_000)),
    centerThresholdFixture(
      'negative residual above threshold',
      700 - quantum,
      Array(8).fill(1_000),
    ),
    centerThresholdFixture(
      'MAD exactly at threshold',
      1_600,
      [920, 920, 920, 920, 1_080, 1_080, 1_080, 1_080],
    ),
    centerThresholdFixture('MAD one quantum above threshold', 1_600, [
      920 - quantum,
      920 - quantum,
      920 - quantum,
      920 - quantum,
      1_080 + quantum,
      1_080 + quantum,
      1_080 + quantum,
      1_080 + quantum,
    ]),
    centerThresholdFixture(
      'consensus exactly at minimum',
      1_600,
      [1_000, 1_000, 1_000, 1_000, 1_000, 1_200, 1_240, 1_280],
    ),
    centerThresholdFixture(
      'consensus one below minimum',
      1_600,
      [1_000, 1_000, 1_000, 1_000, 1_200, 1_240, 1_280, 1_320],
    ),
    centerThresholdFixture('support exactly at maximum', 1_600, [
      1_600 - 80,
      1_000,
      1_000,
      1_000,
      1_000,
      1_000,
      1_000,
      1_000,
    ]),
    centerThresholdFixture('support one above maximum', 1_600, [
      1_600 - 80,
      1_600 + 80,
      1_000,
      1_000,
      1_000,
      1_000,
      1_000,
      1_000,
    ]),
    fixture('missing cardinal neighbors', 7, 5, smooth, (grid) => {
      grid[0][1] = null;
      grid[1][0] = null;
      grid[2][1] = null;
      grid[1][2] = null;
      setTerrariumPixel(grid[1][1], 0, 0, 2_000);
    }),
    fixture('missing diagonal neighbors', 7, 5, smooth, (grid) => {
      grid[0][0] = null;
      grid[0][2] = null;
      grid[2][0] = null;
      grid[2][2] = null;
      setTerrariumPixel(grid[1][1], 6, 4, 2_500);
    }),
    fixture('mixed independent null halo', 7, 5, rugged, (grid) => {
      grid[0][1] = null;
      grid[1][0] = null;
      grid[2][2] = null;
      setTerrariumPixel(grid[1][1], 0, 4, -700);
    }),
    fixture('edge and corner corruption', 8, 6, smooth, (grid) => {
      setTerrariumPixel(grid[1][1], 0, 0, 0, 0);
      setTerrariumPixel(grid[1][1], 7, 0, -32_768);
      setTerrariumPixel(grid[1][1], 0, 5, -700);
      setTerrariumPixel(grid[1][1], 7, 5, 8_500);
    }),
    fixture(
      'no valid neighbor unrepaired',
      1,
      1,
      () => -32_768,
      (grid) => {
        setTerrariumPixel(grid[1][1], 0, 0, 0, 0);
      },
    ),
    corruptedFixture('dense mixed corruption', 32, 20, rugged, 128, 0xde_ad_be_ef),
  ];

  return fixtures;
}

export function createTerrariumBenchmarkFixtures(): readonly TerrariumBenchmarkFixture[] {
  const size = 256;
  return [
    fixture('smooth/no-repair', size, size, smooth),
    fixture('rugged/no-repair', size, size, rugged),
    corruptedFixture('sparse corruption', size, size, smooth, 64, 0x10_20_30_40),
    fixture(
      'bad scanline',
      size,
      size,
      () => 1_100,
      (grid) => {
        for (let x = 0; x < size; x += 1) setTerrariumPixel(grid[1][1], x, 128, -700);
      },
    ),
    corruptedFixture(
      'dense corruption',
      size,
      size,
      rugged,
      Math.floor(size * size * 0.2),
      0xca_fe_ba_be,
    ),
    fixture('missing halo', size, size, rugged, (grid) => {
      grid[0][1] = null;
      grid[1][0] = null;
      grid[2][2] = null;
    }),
  ];
}
