import { describe, expect, it } from "vitest";
import { civilLocation, plantTelemetryReading, productionQuantity } from "../src/lib/civil.js";

describe("civil field validation", () => {
  it("accepts chainage and rejects reversed ranges", () => {
    expect(civilLocation.parse({ alignment: "MC10", chainageStartM: 1200, chainageEndM: 1440 })).toMatchObject({ alignment: "MC10" });
    expect(() => civilLocation.parse({ chainageStartM: 1440, chainageEndM: 1200 })).toThrow(/chainageEndM/);
  });

  it("requires a usable civil location reference", () => {
    expect(() => civilLocation.parse({ latitude: -33.8 })).toThrow(/latitude and longitude/);
    expect(() => civilLocation.parse({ alignment: "MC10" })).toThrow(/Provide chainage/);
    expect(civilLocation.parse({ latitude: -33.8, longitude: 151.2 })).toMatchObject({ latitude: -33.8 });
  });

  it("validates production actuals for estimating feedback", () => {
    expect(productionQuantity.parse({ activity: "Trench excavation", quantity: 42.5, unit: "m", workHours: 6 })).toMatchObject({ activity: "Trench excavation" });
  });

  it("requires at least one plant telemetry measurement", () => {
    expect(() => plantTelemetryReading.parse({ source: "manual", capturedAt: new Date() })).toThrow(/at least one telemetry/);
    expect(plantTelemetryReading.parse({ source: "telematics", capturedAt: new Date(), engineHours: 120.5 })).toMatchObject({ source: "telematics" });
  });
});
