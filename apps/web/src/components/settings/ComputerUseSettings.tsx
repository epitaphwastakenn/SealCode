import type { ComputerUseSettings as ComputerUseSettingsValue } from "@t3tools/contracts";

import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/useSettings";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** Only the desktop app on Windows can host it, beside the backend it launched. */
export function ComputerUseSettings() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const computerUse = settings.computerUse;
  const update = (patch: Partial<ComputerUseSettingsValue>) =>
    updateSettings({ computerUse: patch });

  return (
    <SettingsSection {...searchableSetting("computer-use")}>
      <p className="px-3 text-xs leading-relaxed text-muted-foreground sm:px-4">
        Deixa os agentes verem a tela e usarem mouse e teclado neste computador. Cada aplicativo
        pede sua permissão; navegadores ficam só leitura e terminais e IDEs só aceitam cliques.
        Enquanto o agente trabalha, o SealCode vira um mini-painel no canto da tela, e Esc
        interrompe. Vale para sessões novas dos agentes.
      </p>
      <SettingsRow
        title="Uso do computador"
        description="Oferece as ferramentas de computer use às threads do Claude."
        control={
          <Switch
            checked={computerUse.enabled}
            onCheckedChange={(enabled) => update({ enabled })}
            aria-label="Uso do computador"
          />
        }
      />
      <SettingsRow
        title="Reexibir aplicativos quando o agente terminar"
        description="Restaura as janelas minimizadas para tirar apps não permitidos do caminho do agente."
        control={
          <Switch
            checked={computerUse.restoreHiddenApps}
            disabled={!computerUse.enabled}
            onCheckedChange={(restoreHiddenApps) => update({ restoreHiddenApps })}
            aria-label="Reexibir aplicativos quando o agente terminar"
          />
        }
      />
    </SettingsSection>
  );
}
