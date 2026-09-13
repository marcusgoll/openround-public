export type GeometryRuntimePolicy = {
  allowLiveOverpass: boolean;
  mode: "bundle-only" | "prototype-overpass";
};

type GeometryRuntimeEnvironment = {
  dev?: unknown;
  allowLiveOverpass?: unknown;
};

/**
 * Public Overpass is useful for local previews, but it is not a production
 * dependency. Production builds stay bundle-only unless the operator opts in
 * explicitly while a verified provider adapter is being integrated.
 */
export function resolveGeometryRuntimePolicy(environment: GeometryRuntimeEnvironment): GeometryRuntimePolicy {
  const allowLiveOverpass = environment.dev === true || environment.allowLiveOverpass === "true";
  return {
    allowLiveOverpass,
    mode: allowLiveOverpass ? "prototype-overpass" : "bundle-only",
  };
}
