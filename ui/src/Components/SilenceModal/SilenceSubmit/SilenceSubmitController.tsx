import { FC, useEffect } from "react";

import { observer } from "mobx-react-lite";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft } from "@fortawesome/free-solid-svg-icons/faArrowLeft";

import type { AlertStore } from "Stores/AlertStore";
import type { SilenceFormStore } from "Stores/SilenceFormStore";
import { refreshBackend } from "Components/RefreshButton";
import SingleClusterStatus from "./SingleClusterStatus";
import MultiClusterStatus from "./MultiClusterStatus";

const SilenceSubmitController: FC<{
  alertStore: AlertStore;
  silenceFormStore: SilenceFormStore;
}> = ({ silenceFormStore, alertStore }) => {
  const requests = Object.values(silenceFormStore.data.requestsByCluster);
  const allDone = requests.length > 0 && requests.every((r) => r.isDone);

  // once every cluster has answered (successfully or not) pull the new state
  // from Alertmanager right away instead of waiting for the next interval
  useEffect(() => {
    if (allDone) {
      refreshBackend(alertStore).catch(() => {
        // the regular update interval will still pick the change up
      });
    }
  }, [allDone, alertStore]);

  return (
    <>
      {Object.keys(silenceFormStore.data.requestsByCluster).length === 1 ? (
        <SingleClusterStatus
          silenceFormStore={silenceFormStore}
          alertStore={alertStore}
        />
      ) : (
        <MultiClusterStatus
          silenceFormStore={silenceFormStore}
          alertStore={alertStore}
        />
      )}
      <div className="d-flex flex-row-reverse">
        <button
          type="button"
          className="btn btn-primary"
          onClick={silenceFormStore.data.resetProgress}
        >
          <FontAwesomeIcon icon={faArrowLeft} className="pe-1" />
          Back
        </button>
      </div>
    </>
  );
};

export default observer(SilenceSubmitController);
