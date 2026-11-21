import { FC, useState } from "react";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRotate } from "@fortawesome/free-solid-svg-icons/faRotate";

import { AlertStore, FormatBackendURI } from "Stores/AlertStore";
import { TooltipWrapper } from "Components/TooltipWrapper";

// Asks the backend to pull from every Alertmanager right now and waits for it
// to finish, then makes the main alert table fetch the result.
const refreshBackend = async (alertStore: AlertStore): Promise<void> => {
  const res = await fetch(FormatBackendURI("refresh"), {
    method: "POST",
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  alertStore.status.requestRefresh();
};

// Asks the backend to pull from every Alertmanager right now, then makes the
// UI fetch the result instead of waiting for the next interval.
const RefreshButton: FC<{ alertStore: AlertStore }> = ({ alertStore }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    refreshBackend(alertStore)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setBusy(false));
  };

  return (
    <li className="nav-item components-navbar-button">
      <TooltipWrapper
        title={
          error
            ? `Refresh failed: ${error}`
            : "Reload alerts and silences from Alertmanager now"
        }
      >
        <span
          id="components-refresh"
          className={`nav-link cursor-pointer ${error ? "text-warning" : ""}`}
          onClick={onClick}
        >
          <FontAwesomeIcon icon={faRotate} className="fa-fw" spin={busy} />
        </span>
      </TooltipWrapper>
    </li>
  );
};

export { RefreshButton, refreshBackend };
