"use client";

import { createContext, useContext, type ReactNode } from "react";
import { CameraIdentities, NO_IDENTITIES } from "@/lib/cameraIdentity";

/**
 * The camera identities every camera list below names its cameras by. The page
 * provides the PIV sources' identities; a calibration panel provides its own
 * calibration recording's (an empty map when it has no labels), so a list never
 * names a calibration camera after a PIV camera it was not shown to be.
 */
const CameraIdentityContext = createContext<CameraIdentities>(NO_IDENTITIES);

export function CameraIdentityProvider({
  identities,
  children,
}: {
  identities: CameraIdentities;
  children: ReactNode;
}) {
  return <CameraIdentityContext.Provider value={identities}>{children}</CameraIdentityContext.Provider>;
}

export function useCameraIdentities(): CameraIdentities {
  return useContext(CameraIdentityContext);
}
