import { FC, useMemo, useState } from "react";

import { observer } from "mobx-react-lite";

import type { AlertStore } from "Stores/AlertStore";
import type { Settings } from "Stores/Settings";
import type { SilenceFormStore } from "Stores/SilenceFormStore";
import AlertRow from "./AlertRow";
import { flattenGrids, sortAlerts, SortKey } from "./flatten";

import "./AlertTable.scss";

// extra label columns shown between the alert name and the summary
const defaultColumns = ["instance", "job"];

const PAGE = 200;

const AlertTable: FC<{
  alertStore: AlertStore;
  settingsStore: Settings;
  silenceFormStore: SilenceFormStore;
}> = ({ alertStore, silenceFormStore }) => {
  const [sort, setSort] = useState<{ key: SortKey; reverse: boolean }>({
    key: "state",
    reverse: false,
  });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [limit, setLimit] = useState(PAGE);

  const items = useMemo(
    () =>
      sortAlerts(flattenGrids(alertStore.data.grids), sort.key, sort.reverse),
    [alertStore.data.grids, sort],
  );

  const columns = useMemo(
    () =>
      defaultColumns.filter((c) =>
        items.some((i) => i.labelMap[c] !== undefined),
      ),
    [items],
  );
  const multiCluster =
    Object.keys(alertStore.data.upstreams.clusters).length > 1;

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const header = (label: string, key?: SortKey) => (
    <th
      className={key ? "sortable" : undefined}
      onClick={
        key
          ? () =>
              setSort((s) => ({
                key,
                reverse: s.key === key ? !s.reverse : false,
              }))
          : undefined
      }
    >
      {label}
      {key && sort.key === key ? (sort.reverse ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <div className="components-alert-table container-fluid">
      <table className="table table-sm table-hover align-middle mb-0">
        <thead>
          <tr>
            <th />
            {header("Status", "state")}
            {header("Severity", "severity")}
            {header("Age", "age")}
            {header("Alert", "alertname")}
            {columns.map((c) => header(c))}
            {multiCluster ? header("Cluster") : null}
            {header("Summary")}
            <th />
          </tr>
        </thead>
        <tbody>
          {items.slice(0, limit).map((item) => (
            <AlertRow
              key={item.key}
              item={item}
              columns={columns}
              expanded={expanded.has(item.key)}
              onToggle={() => toggle(item.key)}
              alertStore={alertStore}
              silenceFormStore={silenceFormStore}
            />
          ))}
        </tbody>
      </table>
      {items.length > limit ? (
        <button
          type="button"
          className="btn btn-sm btn-secondary my-2"
          onClick={() => setLimit(limit + PAGE)}
        >
          Show more ({items.length - limit} remaining)
        </button>
      ) : null}
    </div>
  );
};

export default observer(AlertTable);
