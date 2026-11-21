import type {
  APIAlertGroupT,
  APIAlertT,
  APIAnnotationT,
  LabelsT,
  ReadOnly,
  APIGridT,
} from "Models/APITypes";

export interface FlatAlertT {
  key: string;
  group: ReadOnly<APIAlertGroupT>;
  alert: ReadOnly<APIAlertT>;
  // alert labels merged with the ones karma hoisted into the group
  labels: LabelsT;
  annotations: ReadOnly<APIAnnotationT[]>;
  labelMap: { [name: string]: string };
  annotationMap: { [name: string]: string };
  startsAt: number;
}

const stateRank = { active: 0, unprocessed: 1, suppressed: 2 } as const;

export const flattenGrids = (grids: ReadOnly<APIGridT[]>): FlatAlertT[] => {
  const out: FlatAlertT[] = [];
  const seen = new Set<string>();
  for (const grid of grids) {
    for (const group of grid.alertGroups) {
      for (const alert of group.alerts) {
        const key = `${group.id}/${alert.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const labels = [
          ...group.shared.labels,
          ...group.labels.filter(
            (l) => !group.shared.labels.some((s) => s.name === l.name),
          ),
          ...alert.labels,
        ].filter((l, i, all) => all.findIndex((o) => o.name === l.name) === i);
        const annotations = [
          ...alert.annotations,
          ...group.shared.annotations.filter(
            (s) => !alert.annotations.some((a) => a.name === s.name),
          ),
        ];
        out.push({
          key,
          group,
          alert,
          labels,
          annotations,
          labelMap: Object.fromEntries(labels.map((l) => [l.name, l.value])),
          annotationMap: Object.fromEntries(
            annotations.map((a) => [a.name, a.value]),
          ),
          startsAt: Date.parse(alert.startsAt),
        });
      }
    }
  }
  return out;
};

export type SortKey = "state" | "age" | "alertname" | "severity";

const severityRank: { [s: string]: number } = {
  critical: 0,
  major: 1,
  error: 1,
  warning: 2,
  minor: 2,
  info: 3,
  informational: 3,
};

export const sortAlerts = (
  alerts: FlatAlertT[],
  key: SortKey,
  reverse: boolean,
): FlatAlertT[] => {
  const cmp = (a: FlatAlertT, b: FlatAlertT): number => {
    switch (key) {
      case "state":
        return (
          stateRank[a.alert.state] - stateRank[b.alert.state] ||
          b.startsAt - a.startsAt
        );
      case "age":
        return b.startsAt - a.startsAt;
      case "alertname":
        return (
          (a.labelMap.alertname ?? "").localeCompare(
            b.labelMap.alertname ?? "",
          ) || b.startsAt - a.startsAt
        );
      case "severity":
        return (
          (severityRank[a.labelMap.severity] ?? 9) -
            (severityRank[b.labelMap.severity] ?? 9) || b.startsAt - a.startsAt
        );
    }
  };
  const sorted = [...alerts].sort(cmp);
  return reverse ? sorted.reverse() : sorted;
};
