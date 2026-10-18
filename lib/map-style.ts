import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

export type Scheme = "light" | "dark";

type Palette = {
  background: string;
  park: string;
  wood: string;
  ice: string;
  residential: string;
  water: string;
  waterway: string;
  building: string;
  buildingOutline: string;
  path: string;
  minor: string;
  subtle: string;
  casing: string;
  major: string;
  motorway: string;
  rail: string;
  railDash: string;
  boundary: string;
  label: string;
  labelHalo: string;
  roadLabel: string;
  waterLabel: string;
};

export const PALETTES: Record<Scheme, Palette> = {
  light: {
    background: "#f2f3f0",
    park: "#d9ead3",
    wood: "#cfe3c8",
    ice: "#fafafa",
    residential: "#eaeae6",
    water: "#b7d0e4",
    waterway: "#b7d0e4",
    building: "#e3e3de",
    buildingOutline: "#d4d4cf",
    path: "#e6e6e6",
    minor: "#ffffff",
    subtle: "#d9d9d9",
    casing: "#d2d2d2",
    major: "#ffffff",
    motorway: "#fdfdfd",
    rail: "#d0d0d0",
    railDash: "#fafafa",
    boundary: "#b3b3b3",
    label: "#333333",
    labelHalo: "#ffffff",
    roadLabel: "#666666",
    waterLabel: "#495e91",
  },
  dark: {
    background: "#262d3a",
    park: "#1f3b34",
    wood: "#213f37",
    ice: "#2c3442",
    residential: "#29303d",
    water: "#1a2b40",
    waterway: "#22364d",
    building: "#313a49",
    buildingOutline: "#3a4455",
    path: "#323b4a",
    minor: "#3b4558",
    subtle: "#384255",
    casing: "#2a3240",
    major: "#4a5569",
    motorway: "#56627a",
    rail: "#4a5366",
    railDash: "#262d3a",
    boundary: "#56607a",
    label: "#c3cad8",
    labelHalo: "#1d232e",
    roadLabel: "#9aa4b8",
    waterLabel: "#7f9cc2",
  },
};

type Recolor = Partial<Record<string, keyof Palette>>;

const RECOLOR: Record<string, Recolor> = {
  background: { "background-color": "background" },
  park: { "fill-color": "park" },
  water: { "fill-color": "water" },
  landcover_ice_shelf: { "fill-color": "ice" },
  landcover_glacier: { "fill-color": "ice" },
  landuse_residential: { "fill-color": "residential" },
  landcover_wood: { "fill-color": "wood" },
  waterway: { "line-color": "waterway" },
  building: { "fill-color": "building", "fill-outline-color": "buildingOutline" },
  tunnel_motorway_casing: { "line-color": "casing" },
  tunnel_motorway_inner: { "line-color": "major" },
  "aeroway-taxiway": { "line-color": "minor" },
  "aeroway-runway-casing": { "line-color": "casing" },
  "aeroway-area": { "fill-color": "minor" },
  "aeroway-runway": { "line-color": "minor" },
  road_area_pier: { "fill-color": "background" },
  road_pier: { "line-color": "background" },
  highway_path: { "line-color": "path" },
  highway_minor: { "line-color": "minor" },
  highway_major_casing: { "line-color": "casing" },
  highway_major_inner: { "line-color": "major" },
  highway_major_subtle: { "line-color": "subtle" },
  highway_motorway_casing: { "line-color": "casing" },
  highway_motorway_inner: { "line-color": "motorway" },
  highway_motorway_subtle: { "line-color": "subtle" },
  railway_transit: { "line-color": "rail" },
  railway_transit_dashline: { "line-color": "railDash" },
  railway_service: { "line-color": "rail" },
  railway_service_dashline: { "line-color": "railDash" },
  railway: { "line-color": "rail" },
  railway_dashline: { "line-color": "railDash" },
  highway_motorway_bridge_casing: { "line-color": "casing" },
  highway_motorway_bridge_inner: { "line-color": "motorway" },
  boundary_3: { "line-color": "boundary" },
  boundary_2: { "line-color": "boundary" },
  boundary_disputed: { "line-color": "boundary" },
  waterway_line_label: { "text-color": "waterLabel", "text-halo-color": "labelHalo" },
  water_name_point_label: { "text-color": "waterLabel", "text-halo-color": "labelHalo" },
  water_name_line_label: { "text-color": "waterLabel", "text-halo-color": "labelHalo" },
  "highway-name-path": { "text-color": "roadLabel", "text-halo-color": "labelHalo" },
  "highway-name-minor": { "text-color": "roadLabel", "text-halo-color": "labelHalo" },
  "highway-name-major": { "text-color": "roadLabel", "text-halo-color": "labelHalo" },
};

const SYMBOL_DEFAULT: Recolor = { "text-color": "label", "text-halo-color": "labelHalo" };

const DROPPED_LAYERS = /shield/;

export function transitStyle(base: StyleSpecification, scheme: Scheme): StyleSpecification {
  const palette = PALETTES[scheme];
  const layers = base.layers
    .filter((layer) => !DROPPED_LAYERS.test(layer.id))
    .map((layer): LayerSpecification => {
      const recolor = RECOLOR[layer.id] ?? (layer.type === "symbol" ? SYMBOL_DEFAULT : {});
      const entries = Object.entries(recolor) as [string, keyof Palette][];
      if (entries.length === 0) {
        return layer;
      }
      const paint = { ...("paint" in layer ? layer.paint : {}) } as Record<string, unknown>;
      for (const [property, color] of entries) {
        paint[property] = palette[color];
      }
      return { ...layer, paint } as LayerSpecification;
    });
  return { ...base, layers };
}
