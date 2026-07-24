import { describe, expect, it } from "vitest";
import {
  CLARIFOLD_IDENTITY,
  resolveClarifoldRuntimeConfiguration,
  type RuntimeEnvironmentWarning
} from "./clarifold-identity";

describe("Clarifold identity configuration", () => {
  it("defines the public application identity while preserving Quick Study as the legacy domain name", () => {
    expect(CLARIFOLD_IDENTITY).toMatchObject({
      productName: "Clarifold",
      packageName: "clarifold",
      version: "0.2.0",
      bundleIdentifier: "org.jeromegroup.clarifold",
      legacyProductName: "Quick Study"
    });
  });

  it("prefers the canonical data directory and reports a legacy collision", () => {
    const warnings: RuntimeEnvironmentWarning[] = [];
    const configuration = resolveClarifoldRuntimeConfiguration({
      CLARIFOLD_DATA_DIR: "/tmp/clarifold-data",
      QUICK_STUDY_DATA_DIR: "/tmp/quick-study-data"
    }, "/default", (warning) => warnings.push(warning));

    expect(configuration).toMatchObject({
      dataDirectory: "/tmp/clarifold-data",
      dataDirectorySource: "canonical-environment"
    });
    expect(warnings).toEqual([expect.objectContaining({ variable: "QUICK_STUDY_DATA_DIR" })]);
  });

  it("accepts the one beta data alias with a visible deprecation warning", () => {
    const warnings: RuntimeEnvironmentWarning[] = [];
    const configuration = resolveClarifoldRuntimeConfiguration({ QUICK_STUDY_DATA_DIR: "/tmp/legacy" }, "/default", (warning) => {
      warnings.push(warning);
    });

    expect(configuration.dataDirectory).toBe("/tmp/legacy");
    expect(configuration.dataDirectorySource).toBe("legacy-environment");
    expect(warnings[0]?.message).toContain("CLARIFOLD_DATA_DIR");
  });
});
