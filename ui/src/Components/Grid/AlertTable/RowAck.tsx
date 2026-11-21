import { FC, useEffect, useState } from "react";

import { action, toJS } from "mobx";
import { observer } from "mobx-react-lite";

import { addSeconds } from "date-fns/addSeconds";
import { parseISO } from "date-fns/parseISO";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons/faCheck";
import { faCheckCircle } from "@fortawesome/free-solid-svg-icons/faCheckCircle";
import { faRotateLeft } from "@fortawesome/free-solid-svg-icons/faRotateLeft";
import { faSpinner } from "@fortawesome/free-solid-svg-icons/faSpinner";
import { faExclamationCircle } from "@fortawesome/free-solid-svg-icons/faExclamationCircle";

import type { APISilenceT, ReadOnly } from "Models/APITypes";
import type { AlertStore } from "Stores/AlertStore";
import {
  SilenceFormStore,
  GenerateAlertmanagerSilenceData,
  MatcherWithIDT,
} from "Stores/SilenceFormStore";
import { StringToOption } from "Common/Select";
import { refreshBackend } from "Components/RefreshButton";
import type { FlatAlertT } from "./flatten";

// Alertmanager has no ack concept, so an ack is a short lived silence whose
// comment starts with the text before the first %NOW% / %NOWLOC% placeholder
// of alertAcknowledgement.comment. That prefix is how we find acks again.
export const ackCommentPrefix = (alertStore: AlertStore): string =>
  alertStore.settings.values.alertAcknowledgement.comment.split("%")[0];

export interface AckT {
  cluster: string;
  silence: ReadOnly<APISilenceT>;
}

export const findAcks = (alertStore: AlertStore, item: FlatAlertT): AckT[] => {
  const prefix = ackCommentPrefix(alertStore);
  if (prefix === "") return [];
  const now = new Date();
  const acks: AckT[] = [];
  for (const am of item.alert.alertmanager) {
    for (const id of am.silencedBy) {
      const silence = alertStore.data.silences[am.cluster]?.[id];
      if (
        silence &&
        parseISO(silence.endsAt) > now &&
        silence.comment.startsWith(prefix) &&
        !acks.some((a) => a.silence.id === id && a.cluster === am.cluster)
      ) {
        acks.push({ cluster: am.cluster, silence });
      }
    }
  }
  return acks;
};

// try each member of a cluster in turn, the first one to accept wins
const tryMembers = async (
  alertStore: AlertStore,
  cluster: string,
  req: (am: {
    uri: string;
    headers: { [k: string]: string };
    cred: RequestCredentials;
  }) => Promise<Response>,
): Promise<void> => {
  const members = alertStore.data.readWriteAlertmanagers.filter(
    (u) => u.cluster === cluster,
  );
  if (members.length === 0)
    throw new Error(`no writable alertmanager in ${cluster}`);
  let lastError = "";
  for (const am of members) {
    try {
      const res = await req({
        uri: am.uri,
        headers: toJS(am.headers),
        cred: am.corsCredentials,
      });
      if (res.ok) return;
      lastError = `${am.name}: ${res.status} ${await res.text()}`;
    } catch (e) {
      lastError = `${am.name}: ${String(e)}`;
    }
  }
  throw new Error(lastError);
};

const doAck = async (
  alertStore: AlertStore,
  silenceFormStore: SilenceFormStore,
  item: FlatAlertT,
) => {
  const settings = alertStore.settings.values.alertAcknowledgement;
  const author = alertStore.info.authentication.enabled
    ? alertStore.info.authentication.username
    : silenceFormStore.data.author !== ""
      ? silenceFormStore.data.author
      : settings.author;

  const matchers: MatcherWithIDT[] = item.labels.map((l, i) => ({
    id: String(i),
    name: l.name,
    values: [StringToOption(l.value)],
    isEqual: true,
    isRegex: false,
  }));

  const clusters = new Set(item.alert.alertmanager.map((am) => am.cluster));
  const now = new Date();
  const comment = settings.comment
    .replace("%NOW%", now.toUTCString())
    .replace("%NOWLOC%", now.toString());
  const body = JSON.stringify(
    GenerateAlertmanagerSilenceData(
      now,
      addSeconds(now, settings.durationSeconds),
      matchers,
      author,
      comment,
    ),
  );
  for (const cluster of clusters) {
    if (!(cluster in alertStore.data.clustersWithoutReadOnly)) continue;
    await tryMembers(alertStore, cluster, ({ uri, headers, cred }) =>
      fetch(`${uri}/api/v2/silences`, {
        method: "POST",
        body,
        credentials: cred,
        headers: { "Content-Type": "application/json", ...headers },
      }),
    );
  }
};

const doUnack = async (alertStore: AlertStore, acks: AckT[]) => {
  for (const { cluster, silence } of acks) {
    await tryMembers(alertStore, cluster, ({ uri, headers, cred }) =>
      fetch(`${uri}/api/v2/silence/${silence.id}`, {
        method: "DELETE",
        credentials: cred,
        headers,
      }),
    );
  }
};

type Phase = "idle" | "busy" | "done";

export const RowAck: FC<{
  item: FlatAlertT;
  alertStore: AlertStore;
  silenceFormStore: SilenceFormStore;
}> = observer(({ item, alertStore, silenceFormStore }) => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const acks = findAcks(alertStore, item);
  const ackIDs = acks.map((a) => a.silence.id).join(",");

  // alert data refreshed, drop our optimistic state
  useEffect(() => {
    setPhase("idle");
  }, [ackIDs]);

  if (!alertStore.settings.values.alertAcknowledgement.enabled) return null;
  if (Object.keys(alertStore.data.clustersWithoutReadOnly).length === 0)
    return null;

  const acked = acks.length > 0;
  const run = action(() => {
    setPhase("busy");
    setError(null);
    (acked
      ? doUnack(alertStore, acks)
      : doAck(alertStore, silenceFormStore, item)
    )
      .then(() => {
        setPhase("done");
        // pull the new silence state now instead of waiting for the interval,
        // failing to do so is harmless, the regular update will catch up
        refreshBackend(alertStore).catch(() => undefined);
      })
      .catch((e: unknown) => {
        setError(String(e instanceof Error ? e.message : e));
        setPhase("idle");
      });
  });

  const icon =
    phase === "busy"
      ? faSpinner
      : phase === "done"
        ? faCheckCircle
        : error
          ? faExclamationCircle
          : acked
            ? faRotateLeft
            : faCheck;
  const title = error
    ? error
    : phase === "done"
      ? "Done, waiting for the next refresh"
      : acked
        ? `Acknowledged by ${acks[0].silence.createdBy}, until ${new Date(acks[0].silence.endsAt).toLocaleString()}. Click to un-acknowledge`
        : "Acknowledge with a short lived silence";

  return (
    <button
      type="button"
      className={`btn btn-sm py-0 me-1 btn-${error ? "warning" : acked ? "success" : "outline-secondary"}`}
      title={title}
      disabled={phase !== "idle"}
      onClick={run}
    >
      <FontAwesomeIcon icon={icon} spin={phase === "busy"} className="fa-fw" />
    </button>
  );
});
