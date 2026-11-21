import { FC, useEffect, useState } from "react";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch } from "@fortawesome/free-solid-svg-icons/faCircleNotch";

import type { AlertmanagerSilencePayloadT } from "Models/APITypes";
import type { AlertStore } from "Stores/AlertStore";
import type { SilenceFormStore } from "Stores/SilenceFormStore";
import { useFetchAny, UpstreamT } from "Hooks/useFetchAny";

interface PostResponseT {
  silenceID: string;
}

const SilenceSubmitProgress: FC<{
  alertStore: AlertStore;
  silenceFormStore: SilenceFormStore;
  cluster: string;
  members: string[];
  payload: AlertmanagerSilencePayloadT;
}> = ({ alertStore, silenceFormStore, cluster, members, payload }) => {
  const [upstreams, setUpstreams] = useState<UpstreamT[]>([]);
  const { response, error, inProgress, responseURI } =
    useFetchAny<PostResponseT>(upstreams);
  const [publicURIs, setPublicURIs] = useState<{ [key: string]: string }>({});

  // Find cluster name from the cluster label (e.g., "Cluster: am1" -> "am1", "am3" -> find in clusters)
  const findClusterNameForLabel = (
    clusterLabel: string,
    clusters: { readonly [key: string]: readonly string[] },
  ): string | null => {
    if (clusterLabel.startsWith("Cluster: ")) {
      return clusterLabel.slice(9);
    }
    for (const [clusterName, members] of Object.entries(clusters)) {
      if (members.includes(clusterLabel)) {
        return clusterName;
      }
    }
    return null;
  };

  useEffect(() => {
    // Access clusters directly to avoid MobX warning about computed value read outside reactive context
    const clusters = alertStore.data.upstreams.clusters;
    const clusterName = findClusterNameForLabel(cluster, clusters);

    // Use the pre-computed clusterIDByLabel mapping if available (more reliable)
    // Fallback to finding cluster name from label using clusters object
    const lookupKey =
      silenceFormStore.data.clusterIDByLabel[cluster] || clusterName || cluster;

    const uris: { [uri: string]: string } = {};
    const membersToTry = [];
    for (const member of members) {
      if (alertStore.data.isReadOnlyAlertmanager(member)) {
        console.error(`Alertmanager instance "${member}" is read-only`);
      } else {
        const am = alertStore.data.getAlertmanagerByName(member);
        if (am === undefined) {
          console.error(`Alertmanager instance "${member}" not found`);
        } else {
          const uri = `${am.uri}/api/v2/silences`;
          const clusterPayload: AlertmanagerSilencePayloadT = {
            ...payload,
          };
          const silenceIDsByCluster = silenceFormStore.data.silenceIDsByCluster;
          if (Object.keys(silenceIDsByCluster).length > 0) {
            // editing a grouped silence: each cluster has its own silence ID,
            // clusters that were added to the form have none so a new silence
            // must be created there instead of updating the primary one
            const originalSilenceID = lookupKey
              ? silenceIDsByCluster[lookupKey]
              : null;
            if (originalSilenceID) {
              clusterPayload.id = originalSilenceID;
            } else {
              delete clusterPayload.id;
            }
          }
          membersToTry.push({
            uri: uri,
            options: {
              method: "POST",
              body: JSON.stringify(clusterPayload),
              credentials: am.corsCredentials,
              headers: {
                "Content-Type": "application/json",
                ...am.headers,
              },
            },
          });
          uris[uri] = am.publicURI;
        }
      }
    }
    if (membersToTry.length) {
      setPublicURIs(uris);
      setUpstreams(membersToTry);
    }
  }, [alertStore.data, cluster, payload, members, silenceFormStore.data]);

  useEffect(() => {
    if (!inProgress && error !== null) {
      silenceFormStore.data.setRequestsByClusterUpdate(cluster, {
        isDone: true,
        error: error,
      });
    } else if (!inProgress && response !== null) {
      silenceFormStore.data.setRequestsByClusterUpdate(cluster, {
        isDone: true,
        silenceID: response.silenceID,
        silenceLink: `${publicURIs[responseURI as string]}/#/silences/${
          response.silenceID
        }`,
      });
    }
  }, [cluster, error, inProgress, publicURIs, response, responseURI]);

  return <FontAwesomeIcon className="text-muted" icon={faCircleNotch} spin />;
};

export { SilenceSubmitProgress };
