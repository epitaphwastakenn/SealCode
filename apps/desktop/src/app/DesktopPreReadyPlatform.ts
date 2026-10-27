import * as ElectronProtocol from "../electron/ElectronProtocol.ts";

// Complete scheme privileges before later layers can observe app readiness.
export const layer = ElectronProtocol.layerSchemePrivileges;
