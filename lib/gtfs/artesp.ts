import type { Row } from "./zip.ts";

const GRANDE_SAO_PAULO = new Set([
  "ARUJA",
  "BARUERI",
  "BIRITIBA MIRIM",
  "CAIEIRAS",
  "CAJAMAR",
  "CARAPICUIBA",
  "COTIA",
  "DIADEMA",
  "EMBU DAS ARTES",
  "EMBU GUACU",
  "FERRAZ DE VASCONCELOS",
  "FRANCISCO MORATO",
  "FRANCO DA ROCHA",
  "GUARAREMA",
  "GUARULHOS",
  "ITAPECERICA DA SERRA",
  "ITAPEVI",
  "ITAQUAQUECETUBA",
  "JANDIRA",
  "JUQUITIBA",
  "MAIRIPORA",
  "MAUA",
  "MOGI DAS CRUZES",
  "OSASCO",
  "PIRAPORA DO BOM JESUS",
  "POA",
  "RIBEIRAO PIRES",
  "RIO GRANDE DA SERRA",
  "SALESOPOLIS",
  "SANTA ISABEL",
  "SANTANA DE PARNAIBA",
  "SANTO ANDRE",
  "SAO BERNARDO DO CAMPO",
  "SAO CAETANO DO SUL",
  "SAO LOURENCO DA SERRA",
  "SAO PAULO",
  "SP",
  "SUZANO",
  "TABOAO DA SERRA",
  "VARGEM GRANDE PAULISTA",
]);

const LOWERCASE_WORDS = new Set(["da", "das", "de", "do", "dos", "e"]);
const ROMAN_NUMERAL = /^(?=[ivx])x{0,3}(ix|iv|v?i{0,3})$/;

export const EMTU_COLOR = "1D4ED8";

function normalizeCity(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isGrandeSaoPaulo(longName: string): boolean {
  const cities = longName.split(/\)\s*-\s*/).map((part) => normalizeCity(part.split("(")[0]));
  return cities.length === 2 && cities.every((city) => GRANDE_SAO_PAULO.has(city));
}

export function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\p{L}\p{N}]+/gu, (word, offset: number) => {
      if (ROMAN_NUMERAL.test(word)) {
        return word.toUpperCase();
      }
      return offset > 0 && LOWERCASE_WORDS.has(word) ? word : word[0].toUpperCase() + word.slice(1);
    });
}

export function shortStopName(name: string): string {
  return name.split(" - ")[0].trim();
}

export function prepareArtesp(input: { routes: Row[]; trips: Row[]; stops: Row[] }): {
  routes: Row[];
  trips: Row[];
  stops: Row[];
} {
  const routes = input.routes
    .filter((route) => isGrandeSaoPaulo(route.route_long_name))
    .map((route): Row => ({
      ...route,
      route_long_name: titleCase(route.route_long_name),
      route_color: route.route_color || EMTU_COLOR,
      route_text_color: route.route_text_color || "FFFFFF",
    }));
  const routeIds = new Set(routes.map((route) => route.route_id));
  const trips = input.trips
    .filter((trip) => routeIds.has(trip.route_id))
    .map((trip): Row => ({ ...trip, trip_headsign: titleCase(trip.trip_headsign ?? "") }));
  const stops = input.stops.map((stop): Row => ({ ...stop, stop_name: shortStopName(stop.stop_name) }));
  return { routes, trips, stops };
}

export const ARTESP_PACKAGE_URL = "https://dadosabertos.artesp.sp.gov.br/api/3/action/package_show?id=gtfs";

export type CkanResource = { format: string; created: string; url: string };

export function latestZipUrl(resources: CkanResource[]): string | null {
  const zips = resources.filter((resource) => resource.format.toLowerCase() === "zip");
  zips.sort((a, b) => b.created.localeCompare(a.created));
  return zips[0]?.url ?? null;
}
