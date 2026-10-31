import { AuthEnvironmentMaintainScope } from "@t3tools/contracts";

import { isLocalEnvironmentDisabled } from "../../localEnvironment";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentScope } from "../../state/session";

export function useCanManageLocalBackend(): boolean {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const canMaintain = useEnvironmentScope(primaryEnvironmentId, AuthEnvironmentMaintainScope);
  return !isLocalEnvironmentDisabled() && canMaintain;
}
