import identity from "./clarifold-identity.json";

export const CLARIFOLD_IDENTITY = Object.freeze(identity);

export type DataDirectorySource = "default" | "canonical-environment" | "legacy-environment";

export interface ClarifoldRuntimeConfiguration {
  readonly dataDirectory: string;
  readonly dataDirectorySource: DataDirectorySource;
  readonly devUrl: string | null;
  readonly codexPath: string | null;
  readonly leanPath: string | null;
  readonly testArtifactExportPath: string | null;
  readonly testPrimaryFolder: string | null;
  readonly testExternalAttachment: string | null;
  readonly testRelocatedSource: string | null;
  readonly testAuthenticationOpenLog: string | null;
  readonly testVerifierRemovalFailure: string | null;
  readonly testExternalResearch: string | null;
}

export interface RuntimeEnvironmentWarning {
  readonly message: string;
  readonly variable: string;
}

export function resolveClarifoldRuntimeConfiguration(
  environment: NodeJS.ProcessEnv,
  defaultDataDirectory: string,
  warn: (warning: RuntimeEnvironmentWarning) => void = ({ message }) => console.warn(message)
): ClarifoldRuntimeConfiguration {
  const canonicalDataDirectory = nonEmptyEnvironmentValue(environment, identity.canonicalDataDirectoryVariable);
  const legacyDataDirectory = nonEmptyEnvironmentValue(environment, identity.legacyDataDirectoryVariable);
  let dataDirectory = defaultDataDirectory;
  let dataDirectorySource: DataDirectorySource = "default";
  if (canonicalDataDirectory) {
    dataDirectory = canonicalDataDirectory;
    dataDirectorySource = "canonical-environment";
    if (legacyDataDirectory) {
      warn({
        variable: identity.legacyDataDirectoryVariable,
        message: `${identity.legacyDataDirectoryVariable} is ignored because ${identity.canonicalDataDirectoryVariable} is set.`
      });
    }
  } else if (legacyDataDirectory) {
    dataDirectory = legacyDataDirectory;
    dataDirectorySource = "legacy-environment";
    warn({
      variable: identity.legacyDataDirectoryVariable,
      message: `${identity.legacyDataDirectoryVariable} is deprecated for this Clarifold beta; use ${identity.canonicalDataDirectoryVariable} instead.`
    });
  }

  return {
    dataDirectory,
    dataDirectorySource,
    devUrl: nonEmptyEnvironmentValue(environment, identity.developmentUrlVariable),
    codexPath: nonEmptyEnvironmentValue(environment, identity.codexPathVariable),
    leanPath: nonEmptyEnvironmentValue(environment, identity.leanPathVariable),
    testArtifactExportPath: nonEmptyEnvironmentValue(environment, "CLARIFOLD_TEST_ARTIFACT_EXPORT_PATH"),
    testPrimaryFolder: nonEmptyEnvironmentValue(environment, "CLARIFOLD_TEST_PRIMARY_FOLDER"),
    testExternalAttachment: nonEmptyEnvironmentValue(environment, "CLARIFOLD_TEST_EXTERNAL_ATTACHMENT"),
    testRelocatedSource: nonEmptyEnvironmentValue(environment, "CLARIFOLD_TEST_RELOCATED_SOURCE"),
    testAuthenticationOpenLog: nonEmptyEnvironmentValue(environment, "CLARIFOLD_TEST_AUTHENTICATION_OPEN_LOG"),
    testVerifierRemovalFailure: nonEmptyEnvironmentValue(environment, "CLARIFOLD_TEST_VERIFIER_REMOVAL_FAILURE"),
    testExternalResearch: nonEmptyEnvironmentValue(environment, "CLARIFOLD_TEST_EXTERNAL_RESEARCH")
  };
}

function nonEmptyEnvironmentValue(environment: NodeJS.ProcessEnv, variable: string): string | null {
  const value = environment[variable]?.trim();
  return value ? value : null;
}
