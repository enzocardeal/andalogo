import assert from "node:assert/strict";
import { test } from "node:test";
import { isGrandeSaoPaulo, prepareArtesp, shortStopName, titleCase } from "./artesp.ts";

test("isGrandeSaoPaulo needs both end cities in Grande São Paulo", () => {
  assert.equal(isGrandeSaoPaulo("ITAPECERICA DA SERRA (PARQUE PARAISO) - SAO PAULO (METRO CAPAO REDONDO)"), true);
  assert.equal(isGrandeSaoPaulo("MAUA  (JARDIM ITAPEVA) - SAO CAETANO DO SUL (TERMINAL RODOVIARIO NICOLAU DELIC)"), true);
  assert.equal(isGrandeSaoPaulo("SANTO ANDRE (TERMINAL METROPOLITANO SANTO ANDRE - LESTE) - SP (CONJUNTO TEOTONIO VILELA)"), true);
  assert.equal(isGrandeSaoPaulo("EMBU-GUACU (CENTRO) - SAO PAULO (TERMINAL CAPELINHA)"), true);
  assert.equal(isGrandeSaoPaulo("VALINHOS (JARDIM AMERICA) - CAMPINAS (TERMINAL METROPOLITANO)"), false);
  assert.equal(isGrandeSaoPaulo("SAO PAULO (TERMINAL TIETE) - SANTOS (CENTRO)"), false);
  assert.equal(isGrandeSaoPaulo("SEM CIDADES"), false);
});

test("titleCase capitalizes words and keeps short connectors in lower case", () => {
  assert.equal(titleCase("SAO PAULO (METRO CAPAO REDONDO)"), "Sao Paulo (Metro Capao Redondo)");
  assert.equal(titleCase("DA SERRA  DE COTIA"), "Da Serra de Cotia");
  assert.equal(titleCase("GUARULHOS (PARQUE CONTINENTAL II) - JARDIM IV"), "Guarulhos (Parque Continental II) - Jardim IV");
  assert.equal(titleCase("VILA IVONE - LIDO - VIX"), "Vila Ivone - Lido - Vix");
});

test("isGrandeSaoPaulo ignores accents in city names", () => {
  assert.equal(isGrandeSaoPaulo("MAUÁ (CENTRO) - SÃO PAULO (SÉ)"), true);
});

test("shortStopName keeps the street part of an address", () => {
  assert.equal(shortStopName("Rua Juquiá, 636 - Jardim Jamaica, Santo André - SP, 09185-220, Brasil"), "Rua Juquiá, 636");
  assert.equal(shortStopName("Rua Oswaldo Cruz, 74"), "Rua Oswaldo Cruz, 74");
});

test("prepareArtesp keeps Grande São Paulo routes with the EMTU color and readable names", () => {
  const prepared = prepareArtesp({
    routes: [
      { route_id: "001", route_long_name: "COTIA (CENTRO) - SAO PAULO (METRO BUTANTA)", route_type: "3" },
      { route_id: "683", route_long_name: "VALINHOS (CENTRO) - CAMPINAS (CENTRO)", route_type: "3" },
    ],
    trips: [
      { route_id: "001", trip_id: "a", trip_headsign: "SAO PAULO (METRO BUTANTA)" },
      { route_id: "683", trip_id: "b", trip_headsign: "CAMPINAS (CENTRO)" },
    ],
    stops: [{ stop_id: "9", stop_name: "Rua A, 1 - Centro, Cotia - SP, Brasil" }],
  });
  assert.deepEqual(prepared.routes, [
    {
      route_id: "001",
      route_long_name: "Cotia (Centro) - Sao Paulo (Metro Butanta)",
      route_type: "3",
      route_color: "1D4ED8",
      route_text_color: "FFFFFF",
    },
  ]);
  assert.deepEqual(prepared.trips, [{ route_id: "001", trip_id: "a", trip_headsign: "Sao Paulo (Metro Butanta)" }]);
  assert.deepEqual(prepared.stops, [{ stop_id: "9", stop_name: "Rua A, 1" }]);
});
