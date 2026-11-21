import { FC, useState } from "react";

import { observer } from "mobx-react-lite";

import copy from "copy-to-clipboard";

import { parseISO } from "date-fns/parseISO";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight } from "@fortawesome/free-solid-svg-icons/faChevronRight";
import { faChevronDown } from "@fortawesome/free-solid-svg-icons/faChevronDown";
import { faBellSlash } from "@fortawesome/free-solid-svg-icons/faBellSlash";
import { faCopy } from "@fortawesome/free-solid-svg-icons/faCopy";
import { faExternalLinkAlt } from "@fortawesome/free-solid-svg-icons/faExternalLinkAlt";

import type { AlertStore } from "Stores/AlertStore";
import {
  SilenceFormStore,
  AlertmanagerClustersToOption,
} from "Stores/SilenceFormStore";
import { StaticLabels } from "Common/Query";
import { alertToJSON } from "Common/Alert";
import FilteringLabel from "Components/Labels/FilteringLabel";
import { InhibitedByModal } from "Components/InhibitedByModal";
import { DateFromNow } from "Components/DateFromNow";
import { RenderSilence } from "../AlertGrid/AlertGroup/Silences";
import {
  RenderNonLinkAnnotation,
  RenderLinkAnnotation,
} from "../AlertGrid/AlertGroup/Annotation";
import type { FlatAlertT } from "./flatten";
import { RowAck, findAcks } from "./RowAck";

const stateClass = {
  active: "danger",
  suppressed: "success",
  unprocessed: "secondary",
} as const;

const severityClass = (severity: string | undefined): string => {
  switch (severity) {
    case "critical":
    case "major":
    case "error":
      return "danger";
    case "warning":
    case "minor":
      return "warning";
    case "info":
    case "informational":
      return "info";
    default:
      return "secondary";
  }
};

export const silenceAlert = (
  alertStore: AlertStore,
  silenceFormStore: SilenceFormStore,
  { group, alert }: FlatAlertT,
) => {
  const clusters: { [cluster: string]: string[] } = {};
  Object.entries(alertStore.data.clustersWithoutReadOnly).forEach(
    ([cluster, members]) => {
      if (alert.alertmanager.some((am) => am.cluster === cluster)) {
        clusters[cluster] = members;
      }
    },
  );
  silenceFormStore.data.resetProgress();
  silenceFormStore.data.fillMatchersFromGroup(
    group,
    alertStore.settings.values.silenceForm.strip.labels,
    AlertmanagerClustersToOption(clusters),
    [alert],
  );
  silenceFormStore.tab.setTab("editor");
  silenceFormStore.toggle.show();
};

const AlertRow: FC<{
  item: FlatAlertT;
  columns: string[];
  expanded: boolean;
  onToggle: () => void;
  alertStore: AlertStore;
  silenceFormStore: SilenceFormStore;
}> = ({ item, columns, expanded, onToggle, alertStore, silenceFormStore }) => {
  const { alert, group, labelMap, annotationMap } = item;
  const [, setTick] = useState(0);
  const canSilence =
    Object.keys(alertStore.data.clustersWithoutReadOnly).length > 0;
  const acked = findAcks(alertStore, item).length > 0;
  const silenced = alert.alertmanager.some((am) =>
    am.silencedBy.some((id) => {
      const silence = alertStore.data.silences[am.cluster]?.[id];
      return !silence || parseISO(silence.endsAt) > new Date();
    }),
  );
  const inhibitedBy = Array.from(
    new Set(alert.alertmanager.flatMap((am) => am.inhibitedBy)),
  );
  const summary =
    annotationMap.summary ??
    annotationMap.description ??
    annotationMap.message ??
    "";
  const severity = labelMap.severity;
  const multiCluster =
    Object.keys(alertStore.data.upstreams.clusters).length > 1;

  return (
    <>
      <tr
        className={`alert-row alert-row-${alert.state}${expanded ? " expanded" : ""}`}
        onClick={onToggle}
      >
        <td className="col-chevron">
          <FontAwesomeIcon icon={expanded ? faChevronDown : faChevronRight} />
        </td>
        <td className="col-state">
          <span className={`badge bg-${stateClass[alert.state]}`}>
            {acked
              ? "acked"
              : silenced
                ? "silenced"
                : inhibitedBy.length
                  ? "inhibited"
                  : alert.state}
          </span>
        </td>
        <td className="col-severity">
          {severity ? (
            <span className={`badge bg-${severityClass(severity)}`}>
              {severity}
            </span>
          ) : null}
        </td>
        <td className="col-age text-nowrap">
          <DateFromNow timestamp={alert.startsAt} />
        </td>
        <td className="col-name text-nowrap">
          <strong>{labelMap.alertname ?? "(no alertname)"}</strong>
        </td>
        {columns.map((name) => (
          <td key={name} className="col-label text-nowrap">
            {labelMap[name] ?? ""}
          </td>
        ))}
        {multiCluster ? (
          <td className="col-label text-nowrap">
            {Array.from(new Set(alert.alertmanager.map((a) => a.cluster))).join(
              ", ",
            )}
          </td>
        ) : null}
        <td className="col-summary text-truncate">{summary}</td>
        <td
          className="col-actions text-nowrap"
          onClick={(e) => e.stopPropagation()}
        >
          <RowAck
            item={item}
            alertStore={alertStore}
            silenceFormStore={silenceFormStore}
          />
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary py-0"
            title="Silence this alert"
            disabled={!canSilence}
            onClick={() => silenceAlert(alertStore, silenceFormStore, item)}
          >
            <FontAwesomeIcon icon={faBellSlash} />
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr className="alert-detail">
          <td />
          <td colSpan={100}>
            <div className="mb-2">
              {item.labels.map((l) => (
                <FilteringLabel
                  key={l.name}
                  name={l.name}
                  value={l.value}
                  alertStore={alertStore}
                />
              ))}
              {multiCluster
                ? Array.from(
                    new Set(alert.alertmanager.map((a) => a.cluster)),
                  ).map((c) => (
                    <FilteringLabel
                      key={c}
                      name={StaticLabels.AlertmanagerCluster}
                      value={c}
                      alertStore={alertStore}
                    />
                  ))
                : null}
              {alertStore.data.receivers.length > 1 ? (
                <FilteringLabel
                  name={StaticLabels.Receiver}
                  value={alert.receiver}
                  alertStore={alertStore}
                />
              ) : null}
            </div>
            {item.annotations
              .filter((a) => a.isLink === false)
              .map((a) => (
                <RenderNonLinkAnnotation
                  key={a.name}
                  name={a.name}
                  value={a.value}
                  visible={true}
                  allowHTML={alertStore.settings.values.annotationsEnableHTML}
                  afterUpdate={() => setTick((t) => t + 1)}
                />
              ))}
            <div className="mb-2">
              {item.annotations
                .filter((a) => a.isLink === true && a.isAction === false)
                .map((a) => (
                  <RenderLinkAnnotation
                    key={a.name}
                    name={a.name}
                    value={a.value}
                  />
                ))}
              {alert.alertmanager.map((am) => (
                <a
                  key={am.name}
                  className="badge bg-secondary me-1 text-decoration-none"
                  href={am.source}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FontAwesomeIcon icon={faExternalLinkAlt} className="me-1" />
                  {am.name}
                </a>
              ))}
              <span
                className="badge bg-secondary me-1 cursor-pointer"
                onClick={() =>
                  void copy(JSON.stringify(alertToJSON(group, alert)))
                }
              >
                <FontAwesomeIcon icon={faCopy} className="me-1" />
                copy JSON
              </span>
            </div>
            {inhibitedBy.length > 0 ? (
              <InhibitedByModal
                alertStore={alertStore}
                fingerprints={inhibitedBy}
              />
            ) : null}
            {alert.alertmanager.flatMap((am) =>
              Array.from(new Set(am.silencedBy)).map((id) => (
                <RenderSilence
                  key={`${am.cluster}/${id}`}
                  alertStore={alertStore}
                  silenceFormStore={silenceFormStore}
                  afterUpdate={() => setTick((t) => t + 1)}
                  cluster={am.cluster}
                  silenceID={id}
                />
              )),
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
};

export default observer(AlertRow);
