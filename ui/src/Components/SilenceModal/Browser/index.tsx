import {
  use,
  FC,
  useState,
  useEffect,
  ReactNode,
  useCallback,
  useMemo,
} from "react";

import { observer } from "mobx-react-lite";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner } from "@fortawesome/free-solid-svg-icons/faSpinner";
import { faExclamationCircle } from "@fortawesome/free-solid-svg-icons/faExclamationCircle";
import { faSortAmountDownAlt } from "@fortawesome/free-solid-svg-icons/faSortAmountDownAlt";
import { faSortAmountUp } from "@fortawesome/free-solid-svg-icons/faSortAmountUp";
import { faSyncAlt } from "@fortawesome/free-solid-svg-icons/faSyncAlt";
import { faLayerGroup } from "@fortawesome/free-solid-svg-icons/faLayerGroup";

import type { APIManagedSilenceT, APISilenceT } from "Models/APITypes";
import { AlertStore, FormatBackendURI } from "Stores/AlertStore";
import type { SilenceFormStore } from "Stores/SilenceFormStore";
import type { Settings } from "Stores/Settings";
import { useFetchGet, FetchGetOptionsT } from "Hooks/useFetchGet";
import { CommonOptions } from "Common/Fetch";
import { useDebounce } from "Hooks/useDebounce";
import { useIsMobile } from "Hooks/useIsMobile";
import { PageSelect } from "Components/Pagination";
import { ThemeContext } from "Components/Theme";
import { ManagedSilence } from "Components/ManagedSilence";
import {
  ClusterSilenceT,
  SelectableSilence,
  SilenceDelete,
} from "./MassDelete";

const FetchError: FC<{
  message: ReactNode;
}> = ({ message }) => (
  <div className="text-center">
    <h2 className="display-2 text-danger">
      <FontAwesomeIcon icon={faExclamationCircle} />
    </h2>
    <p className="lead text-muted">{message}</p>
  </div>
);

const Placeholder: FC<{
  content: ReactNode;
}> = ({ content }) => {
  const context = use(ThemeContext);
  const animationClass =
    context.animations.duration !== 0 ? "components-animation-fade-enter" : "";

  return (
    <div
      className={`px-2 py-5 bg-transparent${
        animationClass ? ` ${animationClass}` : ""
      }`}
    >
      <h1 className="display-5 text-placeholder text-center">{content}</h1>
    </div>
  );
};

type DisplayItemT =
  | { type: "single"; silence: APIManagedSilenceT }
  | { type: "group"; silences: APIManagedSilenceT[]; alertCount: number };

const GroupedSilence: FC<{
  alertStore: AlertStore;
  silenceFormStore: SilenceFormStore;
  silences: APIManagedSilenceT[];
  alertCount: number;
}> = ({ alertStore, silenceFormStore, silences, alertCount }) => {
  const primarySilence = silences[0];

  const clusters = [...new Set(silences.map((s) => s.cluster))];
  const isReadOnly = silences.every((s) => {
    const clusterAlertmanagers =
      alertStore.data.getClusterAlertmanagersWithoutReadOnly(s.cluster);
    return clusterAlertmanagers.length === 0;
  });

  const onEditSilence = useCallback(() => {
    const alertmanager = alertStore.data.readWriteAlertmanagers
      .filter((u) => u.cluster === primarySilence.cluster)
      .slice(0, 1)[0];

    if (!alertmanager) return;

    silenceFormStore.data.fillFormFromSilence(
      alertmanager,
      primarySilence.silence,
    );

    const silenceIDsByCluster: { [key: string]: string | null } = {};
    const allClusters: { [key: string]: string[] } = {};
    for (const s of silences) {
      const clusterAlertmanagers =
        alertStore.data.getClusterAlertmanagersWithoutReadOnly(s.cluster);
      if (clusterAlertmanagers.length > 0) {
        allClusters[s.cluster] = clusterAlertmanagers;
        silenceIDsByCluster[s.cluster] = s.silence.id;
      }
    }

    silenceFormStore.data.setSilenceIDsByCluster(silenceIDsByCluster);

    const alertmanagerOptions = Object.entries(allClusters).map(
      ([clusterID, clusterMembers]) => ({
        clusterID: clusterID,
        label:
          clusterMembers.length > 1
            ? `Cluster: ${clusterID}`
            : clusterMembers[0],
        value: clusterMembers,
      }),
    );

    // Store a mapping from label to cluster ID for silence ID lookup
    const labelsByClusterID: { [key: string]: string } = {};
    const clusterIDByLabel: { [key: string]: string } = {};
    for (const opt of alertmanagerOptions) {
      labelsByClusterID[opt.clusterID] = opt.label;
      clusterIDByLabel[opt.label] = opt.clusterID;
    }
    silenceFormStore.data.setClusterIDByLabel(clusterIDByLabel);

    if (Object.keys(allClusters).length > 0) {
      silenceFormStore.data.setAlertmanagers(
        alertmanagerOptions.map((opt) => ({
          label: opt.label,
          value: opt.value,
        })),
      );
    }

    silenceFormStore.data.resetProgress();
    silenceFormStore.tab.setTab("editor");
    silenceFormStore.toggle.show();
  }, [alertStore, silenceFormStore, silences, primarySilence]);

  return (
    <div className="d-flex">
      <div className="form-check my-auto">
        <input
          className="form-check-input cursor-pointer"
          type="checkbox"
          value=""
          disabled
        />
      </div>
      <div className="w-100">
        <div className="d-flex align-items-center mb-1">
          <span className="badge bg-info me-2">
            <FontAwesomeIcon icon={faLayerGroup} className="me-1" />
            {clusters.length}x duplicate
          </span>
          {clusters.map((c) => (
            <span key={c} className="badge bg-secondary me-1">
              {c}
            </span>
          ))}
        </div>
        <ManagedSilence
          cluster={primarySilence.cluster}
          alertCount={alertCount}
          alertCountAlwaysVisible={true}
          silence={primarySilence.silence}
          alertStore={alertStore}
          silenceFormStore={silenceFormStore}
          isNested={true}
          isGrouped={true}
          onEditSilence={onEditSilence}
          isReadOnly={isReadOnly}
        />
      </div>
    </div>
  );
};

const Browser: FC<{
  alertStore: AlertStore;
  silenceFormStore: SilenceFormStore;
  settingsStore: Settings;
}> = ({ alertStore, silenceFormStore, settingsStore }) => {
  const maxPerPage = useIsMobile() ? 4 : 6;
  const [sortReverse, setSortReverse] = useState<boolean>(false);
  const [showExpired, setShowExpired] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [groupByDuplicate, setGroupByDuplicate] = useState<boolean>(false);
  const [activePage, setActivePage] = useState<number>(1);
  const [currentTime, setCurrentTime] = useState<number>(() =>
    Math.floor(Date.now() / 1000),
  );

  const debouncedSearchTerm = useDebounce<string>(searchTerm, 500);

  const { response, error, isLoading, isRetrying, get } = useFetchGet<
    APIManagedSilenceT[]
  >(
    FormatBackendURI(
      `silences.json?sortReverse=${sortReverse ? "1" : "0"}&showExpired=${
        showExpired ? "1" : "0"
      }&searchTerm=${debouncedSearchTerm}`,
    ),
    { deps: [currentTime] } as FetchGetOptionsT,
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Math.floor(Date.now() / 1000));
    }, settingsStore.fetchConfig.config.interval * 1000);
    return () => clearInterval(timer);
  }, [settingsStore.fetchConfig.config.interval]);

  const [isPulling, setIsPulling] = useState<boolean>(false);

  // ask the backend to pull from Alertmanager now, then re-read silences
  const refresh = useCallback(async () => {
    setIsPulling(true);
    try {
      await fetch(FormatBackendURI("pull"), {
        ...CommonOptions,
        method: "POST",
      });
    } catch {
      // fall through, re-reading cached data is still useful
    }
    setIsPulling(false);
    get();
  }, [get]);

  const [selected, setSelected] = useState<ClusterSilenceT[]>([]);
  const [allSelected, setAllSelected] = useState(false);

  useEffect(() => {
    if (response && !isLoading && error === null) {
      const sids: string[] = response
        .filter((silence) => !silence.isExpired)
        .map((silence) => silence.silence.id);
      setSelected((selected) => selected.filter((s) => sids.includes(s.id)));
    }
  }, [error, isLoading, response]);

  const [isDeleteMenuOpen, setIsDeleteMenuOpen] = useState<boolean>(false);
  const hideDeleteMenu = useCallback(() => setIsDeleteMenuOpen(false), []);
  const toggleDeleteMenu = useCallback(
    () => setIsDeleteMenuOpen(!isDeleteMenuOpen),
    [isDeleteMenuOpen],
  );

  const onSelect = useCallback(
    (cluster: string, id: string, checked: boolean) => {
      if (checked) {
        setSelected((sv) =>
          Array.from(new Set([{ id: id, cluster: cluster }, ...sv])),
        );
      } else {
        setSelected((sv) =>
          sv.filter((s) => !(s.id === id && s.cluster === cluster)),
        );
      }
      setAllSelected(false);
    },
    [setSelected, setAllSelected],
  );

  const getMatcherSignature = (silence: APISilenceT): string => {
    const sorted = [...silence.matchers].sort((a, b) => {
      const cmp = a.name.localeCompare(b.name);
      if (cmp !== 0) return cmp;
      if (a.isRegex !== b.isRegex) return a.isRegex ? 1 : -1;
      if (a.isEqual !== b.isEqual) return a.isEqual ? 1 : -1;
      return a.value.localeCompare(b.value);
    });
    return sorted
      .map(
        (m) =>
          `${m.name}${m.isRegex ? "~" : "="}${m.isEqual ? "" : "!"}${m.value}`,
      )
      .join("|");
  };

  // pagination operates on display items, so that a group of duplicates counts
  // as a single entry and is never split across pages
  const displayItems = useMemo((): DisplayItemT[] => {
    if (!response) return [];
    if (!groupByDuplicate) {
      return response.map((silence) => ({ type: "single", silence }));
    }

    const groupMap = new Map<string, APIManagedSilenceT[]>();
    for (const s of response) {
      const key = getMatcherSignature(s.silence);
      const members = groupMap.get(key);
      if (members) {
        members.push(s);
      } else {
        groupMap.set(key, [s]);
      }
    }

    const groups: DisplayItemT[] = [];
    const singles: DisplayItemT[] = [];
    for (const silences of groupMap.values()) {
      if (silences.length > 1) {
        groups.push({
          type: "group",
          silences,
          alertCount: silences.reduce((sum, s) => sum + s.alertCount, 0),
        });
      } else {
        singles.push({ type: "single", silence: silences[0] });
      }
    }
    return [...groups, ...singles];
  }, [response, groupByDuplicate]);

  return (
    <>
      <div
        className="d-flex flex-fill flex-lg-row flex-column justify-content-between mb-3"
        data-refresh={settingsStore.fetchConfig.config.interval}
      >
        <div className="d-flex flex-row flex-wrap gap-2 align-items-center">
          <span className="form-check form-switch my-auto flex-grow-0 flex-shrink-0">
            <input
              id="silence-show-expired"
              className="form-check-input"
              type="checkbox"
              value=""
              checked={showExpired}
              onChange={() => setShowExpired(!showExpired)}
            />
            <label
              className="form-check-label cursor-pointer"
              htmlFor="silence-show-expired"
            >
              Show expired
            </label>
          </span>
          <span className="form-check form-switch my-auto flex-grow-0 flex-shrink-0">
            <input
              id="silence-group-duplicates"
              className="form-check-input"
              type="checkbox"
              value=""
              checked={groupByDuplicate}
              onChange={() => {
                setGroupByDuplicate(!groupByDuplicate);
                setActivePage(1);
              }}
            />
            <label
              className="form-check-label cursor-pointer"
              htmlFor="silence-group-duplicates"
            >
              Group duplicates
            </label>
          </span>
        </div>
        <input
          type="text"
          className="form-control flex-grow-1 flex-shrink-1 mx-lg-3 mx-0 my-lg-0 my-2"
          placeholder="Search query"
          value={searchTerm}
          autoComplete="off"
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-secondary flex-grow-0 flex-shrink-0"
          onClick={() => setSortReverse(!sortReverse)}
        >
          <FontAwesomeIcon
            className="me-1"
            icon={sortReverse ? faSortAmountUp : faSortAmountDownAlt}
          />
          Sort order
        </button>
        <button
          type="button"
          className="btn btn-secondary flex-grow-0 flex-shrink-0 ms-lg-2 ms-0 mt-lg-0 mt-2"
          title="Refresh silences"
          disabled={isLoading || isPulling}
          onClick={refresh}
        >
          <FontAwesomeIcon
            className="me-1"
            icon={faSyncAlt}
            spin={isLoading || isPulling}
          />
          Refresh
        </button>
      </div>
      {isLoading && response === null ? (
        <Placeholder
          content={
            <FontAwesomeIcon
              icon={faSpinner}
              size="lg"
              spin
              className={isRetrying ? "text-danger" : ""}
            />
          }
        />
      ) : error !== null ? (
        <FetchError message={error} />
      ) : response === null || response.length === 0 ? (
        <Placeholder content="Nothing to show" />
      ) : (
        <>
          {displayItems
            .slice((activePage - 1) * maxPerPage, activePage * maxPerPage)
            .map((item) =>
              item.type === "group" ? (
                <GroupedSilence
                  key={`${item.silences[0].cluster}/${item.silences[0].silence.id}/grouped`}
                  silences={item.silences}
                  alertCount={item.alertCount}
                  alertStore={alertStore}
                  silenceFormStore={silenceFormStore}
                />
              ) : (
                <SelectableSilence
                  key={`${item.silence.cluster}/${item.silence.silence.id}`}
                  silence={item.silence}
                  alertStore={alertStore}
                  silenceFormStore={silenceFormStore}
                  selected={selected
                    .map((s) => s.id)
                    .includes(item.silence.silence.id)}
                  onSelect={onSelect}
                />
              ),
            )}
          <div className="d-flex flex-wrap">
            <div className="flex-grow-0 flex-shrink-0 my-auto mx-1">
              <SilenceDelete
                alertStore={alertStore}
                silenceFormStore={silenceFormStore}
                disabled={selected.length === 0}
                silences={selected}
                isOpen={isDeleteMenuOpen}
                toggle={toggleDeleteMenu}
              >
                <button
                  className="dropdown-item cursor-pointer px-3"
                  onClick={() => {
                    const v = !allSelected;
                    if (v) {
                      setSelected(
                        response
                          .filter((silence) => !silence.isExpired)
                          .map((silence) => ({
                            id: silence.silence.id,
                            cluster: silence.cluster,
                          })),
                      );
                    } else {
                      setSelected([]);
                    }
                    hideDeleteMenu();
                    setAllSelected(v);
                  }}
                >
                  {allSelected ? "Select none" : "Select all"}
                </button>
              </SilenceDelete>
            </div>
            <div className="mx-auto">
              <PageSelect
                totalPages={Math.ceil(displayItems.length / maxPerPage)}
                maxPerPage={maxPerPage}
                totalItemsCount={displayItems.length}
                setPageCallback={setActivePage}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default observer(Browser);
