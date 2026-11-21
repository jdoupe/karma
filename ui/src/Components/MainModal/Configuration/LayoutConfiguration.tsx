import { use, FC } from "react";

import { observer } from "mobx-react-lite";

import Select, { OnChangeValue } from "react-select";

import type { LayoutT } from "Models/UI";
import type { OptionT } from "Common/Select";
import type { Settings } from "Stores/Settings";
import { AnimatedMenu } from "Components/Select";
import { ThemeContext } from "Components/Theme";

const LayoutConfiguration: FC<{
  settingsStore: Settings;
}> = observer(({ settingsStore }) => {
  const context = use(ThemeContext);
  const current = settingsStore.layoutConfig.layout;

  return (
    <div className="mb-2">
      <Select
        styles={context.reactSelectStyles}
        classNamePrefix="react-select"
        instanceId="configuration-layout"
        value={settingsStore.layoutConfig.options[current] as OptionT}
        options={Object.values(settingsStore.layoutConfig.options) as OptionT[]}
        onChange={(option: OnChangeValue<OptionT, false>) =>
          settingsStore.layoutConfig.setLayout(
            (option as OptionT).value as LayoutT,
          )
        }
        hideSelectedOptions
        components={{
          Menu: AnimatedMenu,
        }}
      />
    </div>
  );
});

export { LayoutConfiguration };
