import { act } from "react";

import { render } from "@testing-library/react";

import fetchMock from "@fetch-mock/jest";

import { AlertStore } from "Stores/AlertStore";
import { SilenceFormStore, NewClusterRequest } from "Stores/SilenceFormStore";
import { SilenceSubmitProgress } from "./SilenceSubmitProgress";
import type { APIAlertsResponseUpstreamsT } from "Models/APITypes";

let alertStore: AlertStore;
let silenceFormStore: SilenceFormStore;

const generateUpstreams = (): APIAlertsResponseUpstreamsT => ({
  counters: { total: 1, healthy: 1, failed: 0 },
  clusters: { mockAlertmanager: ["mockAlertmanager"] },
  instances: [
    {
      name: "mockAlertmanager",
      uri: "http://localhost",
      publicURI: "http://example.com",
      readonly: false,
      headers: { foo: "bar" },
      corsCredentials: "include",
      error: "",
      version: "0.24.0",
      cluster: "mockAlertmanager",
      clusterMembers: ["mockAlertmanager"],
    },
  ],
});

beforeEach(() => {
  alertStore = new AlertStore([]);
  silenceFormStore = new SilenceFormStore();

  alertStore.data.setUpstreams(generateUpstreams());

  silenceFormStore.data.setRequestsByCluster({
    mockAlertmanager: NewClusterRequest("mockAlertmanager", [
      "mockAlertmanager",
    ]),
  });

  fetchMock.mockClear();
  fetchMock.route(
    "*",
    {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ silenceID: "123456789" }),
    },
    {
      overwriteRoutes: true,
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
  fetchMock.mockClear();
});

const renderSilenceSubmitProgress = () => {
  return render(
    <SilenceSubmitProgress
      cluster="mockAlertmanager"
      members={["mockAlertmanager"]}
      payload={{
        matchers: [],
        startsAt: "now",
        endsAt: "later",
        createdBy: "me@example.com",
        comment: "fake payload",
      }}
      alertStore={alertStore}
      silenceFormStore={silenceFormStore}
    />,
  );
};

describe("<SilenceSubmitProgress />", () => {
  it("sends a request on mount", async () => {
    renderSilenceSubmitProgress();
    await act(async () => {
      await fetchMock.callHistory.flush(true);
    });
    expect(fetchMock.callHistory.calls()).toHaveLength(1);
  });

  it("appends /api/v2/silences to the passed URI", async () => {
    renderSilenceSubmitProgress();
    await act(async () => {
      await fetchMock.callHistory.flush(true);
    });
    const uri = fetchMock.callHistory.calls()[0]?.url;
    expect(uri).toBe("http://localhost/api/v2/silences");
  });

  it("sends correct JSON payload", async () => {
    renderSilenceSubmitProgress();
    await act(async () => {
      await fetchMock.callHistory.flush(true);
    });
    const payload = fetchMock.callHistory.calls()[0]?.options;
    expect(payload).toMatchObject({
      method: "post",
      body: JSON.stringify({
        matchers: [],
        startsAt: "now",
        endsAt: "later",
        createdBy: "me@example.com",
        comment: "fake payload",
      }),
    });
    // Check headers - stored as plain object
    const headers = payload?.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["foo"]).toBe("bar");
  });

  it("uses CORS credentials from alertmanager config", async () => {
    const upstreams = generateUpstreams();
    upstreams.instances[0].corsCredentials = "same-origin";
    alertStore.data.setUpstreams(upstreams);
    renderSilenceSubmitProgress();
    await act(async () => {
      await fetchMock.callHistory.flush(true);
    });
    expect(fetchMock.callHistory.calls()[0]?.url).toBe(
      "http://localhost/api/v2/silences",
    );
    expect(fetchMock.callHistory.calls()[0]?.options).toMatchObject({
      credentials: "same-origin",
      method: "post",
    });
  });

  it("will retry on another cluster member after fetch failure", async () => {
    fetchMock.mockReset();
    fetchMock.route("http://am2.example.com/api/v2/silences", {
      throws: new TypeError("failed to fetch"),
    });
    fetchMock.route("http://am1.example.com/api/v2/silences", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ silenceID: "123456789" }),
    });
    alertStore.data.setUpstreams({
      counters: { total: 1, healthy: 1, failed: 0 },
      clusters: { ha: ["am1", "am2"] },
      instances: [
        {
          name: "am1",
          uri: "http://am1.example.com",
          publicURI: "http://am1.example.com",
          readonly: false,
          headers: {},
          corsCredentials: "include",
          error: "",
          version: "0.24.0",
          cluster: "ha",
          clusterMembers: ["am1", "am2"],
        },
        {
          name: "am2",
          uri: "http://am2.example.com",
          publicURI: "http://am2.example.com",
          readonly: false,
          headers: {},
          corsCredentials: "include",
          error: "",
          version: "0.24.0",
          cluster: "ha",
          clusterMembers: ["am1", "am2"],
        },
      ],
    });
    silenceFormStore.data.setRequestsByCluster({
      ha: NewClusterRequest("ha", ["am1", "am2"]),
    });

    render(
      <SilenceSubmitProgress
        cluster="ha"
        members={["am2", "am1"]}
        payload={{
          matchers: [],
          startsAt: "now",
          endsAt: "later",
          createdBy: "me@example.com",
          comment: "fake payload",
        }}
        alertStore={alertStore}
        silenceFormStore={silenceFormStore}
      />,
    );
    await act(async () => {
      await fetchMock.callHistory.flush(true);
    });
    expect(fetchMock.callHistory.calls()[0]?.url).toBe(
      "http://am2.example.com/api/v2/silences",
    );
    expect(fetchMock.callHistory.calls()).toHaveLength(2);
    expect(fetchMock.callHistory.calls()[1]?.url).toBe(
      "http://am1.example.com/api/v2/silences",
    );
  });

  it("will use error message from last failed cluster member", async () => {
    fetchMock.mockReset();
    fetchMock.route("http://am2.example.com/api/v2/silences", {
      throws: new TypeError("failed to fetch from am2"),
    });
    fetchMock.route("http://am1.example.com/api/v2/silences", {
      throws: new TypeError("failed to fetch from am1"),
    });
    alertStore.data.setUpstreams({
      counters: { total: 2, healthy: 0, failed: 2 },
      clusters: { ha: ["am1", "am2"] },
      instances: [
        {
          name: "am1",
          uri: "http://am1.example.com",
          publicURI: "http://am1.example.com",
          readonly: false,
          headers: {},
          corsCredentials: "include",
          error: "",
          version: "0.24.0",
          cluster: "ha",
          clusterMembers: ["am1", "am2"],
        },
        {
          name: "am2",
          uri: "http://am2.example.com",
          publicURI: "http://am2.example.com",
          readonly: false,
          headers: {},
          corsCredentials: "include",
          error: "",
          version: "0.24.0",
          cluster: "ha",
          clusterMembers: ["am1", "am2"],
        },
      ],
    });
    silenceFormStore.data.setRequestsByCluster({
      ha: NewClusterRequest("ha", ["am1", "am2"]),
    });

    render(
      <SilenceSubmitProgress
        cluster="ha"
        members={["am2", "am1"]}
        payload={{
          matchers: [],
          startsAt: "now",
          endsAt: "later",
          createdBy: "me@example.com",
          comment: "fake payload",
        }}
        alertStore={alertStore}
        silenceFormStore={silenceFormStore}
      />,
    );
    await act(async () => {
      await fetchMock.callHistory.flush(true);
    });
    expect(fetchMock.callHistory.calls()).toHaveLength(2);
    expect(silenceFormStore.data.requestsByCluster.ha).toMatchObject({
      isDone: true,
      error: "failed to fetch from am1",
    });
  });

  it("will log an error if Alertmanager instance is missing from instances and try the next one", async () => {
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    alertStore.data.setUpstreams({
      counters: { total: 2, healthy: 2, failed: 0 },
      clusters: { ha: ["am1", "am2"] },
      instances: [
        {
          name: "am1",
          uri: "http://am1.example.com",
          publicURI: "http://am1.example.com",
          readonly: false,
          headers: {},
          corsCredentials: "include",
          error: "",
          version: "0.24.0",
          cluster: "ha",
          clusterMembers: ["am1", "am2"],
        },
      ],
    });
    silenceFormStore.data.setRequestsByCluster({
      ha: NewClusterRequest("ha", ["am1", "am2"]),
    });

    render(
      <SilenceSubmitProgress
        cluster="ha"
        members={["am2", "am1"]}
        payload={{
          matchers: [],
          startsAt: "now",
          endsAt: "later",
          createdBy: "me@example.com",
          comment: "fake payload",
        }}
        alertStore={alertStore}
        silenceFormStore={silenceFormStore}
      />,
    );
    await act(async () => {
      await fetchMock.callHistory.flush(true);
    });
    expect(fetchMock.callHistory.calls()[0]?.url).toBe(
      "http://am1.example.com/api/v2/silences",
    );
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it("will log an error if all members are missing from instances", async () => {
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    alertStore.data.setUpstreams({
      counters: { total: 2, healthy: 2, failed: 0 },
      clusters: { ha: ["am1", "am2"] },
      instances: [],
    });
    silenceFormStore.data.setRequestsByCluster({
      ha: NewClusterRequest("ha", ["am1", "am2"]),
    });

    render(
      <SilenceSubmitProgress
        cluster="ha"
        members={["am2", "am1"]}
        payload={{
          matchers: [],
          startsAt: "now",
          endsAt: "later",
          createdBy: "me@example.com",
          comment: "fake payload",
        }}
        alertStore={alertStore}
        silenceFormStore={silenceFormStore}
      />,
    );
    await act(async () => {
      await fetchMock.callHistory.flush(true);
    });
    expect(fetchMock.callHistory.calls()).toHaveLength(0);
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });

  it("will refuse to send requests to an alertmanager instance that is readonly", async () => {
    const logs: string[] = [];
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation((message, ..._) => {
        logs.push(message);
      });

    alertStore.data.setUpstreams({
      counters: { total: 2, healthy: 2, failed: 0 },
      clusters: { ha: ["am1", "am2"] },
      instances: [
        {
          name: "am1",
          uri: "http://am1.example.com",
          publicURI: "http://am1.example.com",
          readonly: false,
          headers: {},
          corsCredentials: "include",
          error: "",
          version: "0.24.0",
          cluster: "ha",
          clusterMembers: ["am1", "am2"],
        },
        {
          name: "am2",
          uri: "http://am2.example.com",
          publicURI: "http://am2.example.com",
          readonly: true,
          headers: {},
          corsCredentials: "include",
          error: "",
          version: "0.24.0",
          cluster: "ha",
          clusterMembers: ["am1", "am2"],
        },
      ],
    });
    silenceFormStore.data.setRequestsByCluster({
      ha: NewClusterRequest("ha", ["am1", "am2"]),
    });

    render(
      <SilenceSubmitProgress
        cluster="ha"
        members={["am2", "am1"]}
        payload={{
          matchers: [],
          startsAt: "now",
          endsAt: "later",
          createdBy: "me@example.com",
          comment: "fake payload",
        }}
        alertStore={alertStore}
        silenceFormStore={silenceFormStore}
      />,
    );
    await act(async () => {
      await fetchMock.callHistory.flush(true);
    });
    expect(fetchMock.callHistory.calls()).toHaveLength(1);
    expect(fetchMock.callHistory.calls()[0]?.url).toBe(
      "http://am1.example.com/api/v2/silences",
    );
    expect(logs).toEqual(['Alertmanager instance "am2" is read-only']);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it("will log an error if all members are readonly", async () => {
    const logs: string[] = [];
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation((message, ..._) => {
        logs.push(message);
      });

    alertStore.data.setUpstreams({
      counters: { total: 2, healthy: 2, failed: 0 },
      clusters: { ha: ["am1", "am2"] },
      instances: [
        {
          name: "am1",
          uri: "http://am1.example.com",
          publicURI: "http://am1.example.com",
          readonly: true,
          headers: {},
          corsCredentials: "include",
          error: "",
          version: "0.24.0",
          cluster: "ha",
          clusterMembers: ["am1", "am2"],
        },
        {
          name: "am2",
          uri: "http://am2.example.com",
          publicURI: "http://am2.example.com",
          readonly: true,
          headers: {},
          corsCredentials: "include",
          error: "",
          version: "0.24.0",
          cluster: "ha",
          clusterMembers: ["am1", "am2"],
        },
      ],
    });
    silenceFormStore.data.setRequestsByCluster({
      ha: NewClusterRequest("ha", ["am1", "am2"]),
    });

    render(
      <SilenceSubmitProgress
        cluster="ha"
        members={["am2", "am1"]}
        payload={{
          matchers: [],
          startsAt: "now",
          endsAt: "later",
          createdBy: "me@example.com",
          comment: "fake payload",
        }}
        alertStore={alertStore}
        silenceFormStore={silenceFormStore}
      />,
    );
    expect(fetchMock.callHistory.calls()).toHaveLength(0);
    expect(logs).toEqual([
      'Alertmanager instance "am2" is read-only',
      'Alertmanager instance "am1" is read-only',
    ]);
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });

  it("renders silence link on successful fetch", async () => {
    renderSilenceSubmitProgress();
    await act(async () => {
      await fetchMock.callHistory.flush(true);
    });
    expect(
      silenceFormStore.data.requestsByCluster.mockAlertmanager,
    ).toMatchObject({
      isDone: true,
      error: null,
      silenceID: "123456789",
      silenceLink: "http://example.com/#/silences/123456789",
    });
  });

  it("sets error icon on failed fetch", async () => {
    fetchMock.mockReset();
    fetchMock.route("*", {
      status: 500,
      body: "error message",
    });
    renderSilenceSubmitProgress();
    await act(async () => {
      await fetchMock.callHistory.flush(true);
    });
    expect(
      silenceFormStore.data.requestsByCluster.mockAlertmanager,
    ).toMatchObject({
      isDone: true,
      error: "error message",
    });
  });

  it("uses cluster-specific silence ID from silenceIDsByCluster when editing grouped silence", async () => {
    // Set up multi-cluster scenario
    const multiClusterUpstreams: APIAlertsResponseUpstreamsT = {
      counters: { total: 2, healthy: 2, failed: 0 },
      clusters: {
        haCluster: ["am1", "am2"],
        singleCluster: ["am3"],
      },
      instances: [
        {
          name: "am1",
          uri: "http://am1:9093",
          publicURI: "http://am1.example.com",
          readonly: false,
          headers: {},
          corsCredentials: "include",
          error: "",
          version: "0.24.0",
          cluster: "haCluster",
          clusterMembers: ["am1", "am2"],
        },
        {
          name: "am2",
          uri: "http://am2:9093",
          publicURI: "http://am2.example.com",
          readonly: false,
          headers: {},
          corsCredentials: "include",
          error: "",
          version: "0.24.0",
          cluster: "haCluster",
          clusterMembers: ["am1", "am2"],
        },
        {
          name: "am3",
          uri: "http://am3:9093",
          publicURI: "http://am3.example.com",
          readonly: false,
          headers: {},
          corsCredentials: "include",
          error: "",
          version: "0.24.0",
          cluster: "singleCluster",
          clusterMembers: ["am3"],
        },
      ],
    };

    alertStore.data.setUpstreams(multiClusterUpstreams);

    // Simulate the onEditSilence flow from GroupedSilence
    // This is what gets called when user clicks "Edit" on a grouped silence
    const silenceIDsByCluster: { [key: string]: string | null } = {};
    const allClusters: { [key: string]: string[] } = {};
    
    // Simulate silences from different clusters with different IDs
    const groupedSilences = [
      { cluster: "haCluster", silence: { id: "silence-id-ha" } },
      { cluster: "singleCluster", silence: { id: "silence-id-single" } },
    ];
    
    for (const s of groupedSilences) {
      const clusterAlertmanagers =
        alertStore.data.getClusterAlertmanagersWithoutReadOnly(s.cluster);
      if (clusterAlertmanagers.length > 0) {
        allClusters[s.cluster] = clusterAlertmanagers;
        silenceIDsByCluster[s.cluster] = s.silence.id;
      }
    }

    silenceFormStore.data.setSilenceIDsByCluster(silenceIDsByCluster);
    silenceFormStore.data.setAlertmanagers(
      Object.entries(allClusters).map(([clusterID, clusterMembers]) => ({
        label:
          clusterMembers.length > 1
            ? `Cluster: ${clusterID}`
            : clusterMembers[0],
        value: clusterMembers,
      })),
    );

    // Now simulate the submission flow
    // requestsByCluster is created in SilenceForm.handleSubmit
    const rbc: { [label: string]: any } = {};
    silenceFormStore.data.alertmanagers.forEach((am) => {
      rbc[am.label] = {
        cluster: am.label,
        members: am.value,
        isDone: false,
        silenceID: undefined,
        silenceLink: undefined,
        error: null,
      };
    });
    silenceFormStore.data.setRequestsByCluster(rbc);

    fetchMock.mockReset();
    fetchMock.route("http://am1:9093/api/v2/silences", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ silenceID: "updated-silence-ha" }),
    });
    fetchMock.route("http://am3:9093/api/v2/silences", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ silenceID: "updated-silence-single" }),
    });

    // Render submissions for both clusters
    render(
      <SilenceSubmitProgress
        cluster="Cluster: haCluster"
        members={["am1", "am2"]}
        payload={{
          matchers: [],
          startsAt: "now",
          endsAt: "later",
          createdBy: "me@example.com",
          comment: "test",
        }}
        alertStore={alertStore}
        silenceFormStore={silenceFormStore}
      />,
    );
    render(
      <SilenceSubmitProgress
        cluster="am3"
        members={["am3"]}
        payload={{
          matchers: [],
          startsAt: "now",
          endsAt: "later",
          createdBy: "me@example.com",
          comment: "test",
        }}
        alertStore={alertStore}
        silenceFormStore={silenceFormStore}
      />,
    );

    await act(async () => {
      await fetchMock.callHistory.flush(true);
    });

    // Verify that each cluster received the correct silence ID
    const calls = fetchMock.callHistory.calls();
    expect(calls).toHaveLength(2);

    const haCall = calls.find((c) => c?.url?.includes("am1:9093"));
    const singleCall = calls.find((c) => c?.url?.includes("am3:9093"));

    expect(haCall).toBeDefined();
    expect(singleCall).toBeDefined();

    // Check that the correct silence IDs were sent
    const haBody = JSON.parse(haCall?.options?.body as string);
    const singleBody = JSON.parse(singleCall?.options?.body as string);

    expect(haBody.id).toBe("silence-id-ha");
    expect(singleBody.id).toBe("silence-id-single");
  });

  it("creates a new silence on a cluster added while editing a grouped silence", async () => {
    alertStore.data.setUpstreams({
      counters: { total: 2, healthy: 2, failed: 0 },
      clusters: { am1: ["am1"], am3: ["am3"] },
      instances: ["am1", "am3"].map((name) => ({
        name,
        uri: `http://${name}:9093`,
        publicURI: `http://${name}.example.com`,
        readonly: false,
        headers: {},
        corsCredentials: "include" as const,
        error: "",
        version: "0.24.0",
        cluster: name,
        clusterMembers: [name],
      })),
    });
    silenceFormStore.data.setSilenceIDsByCluster({ am1: "silence-id-1" });

    fetchMock.mockReset();
    for (const name of ["am1", "am3"]) {
      fetchMock.route(`http://${name}:9093/api/v2/silences`, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ silenceID: `result-${name}` }),
      });
    }

    // payload carries the primary silence ID, like toAlertmanagerPayload does
    const payload = {
      id: "silence-id-1",
      matchers: [],
      startsAt: "now",
      endsAt: "later",
      createdBy: "me@example.com",
      comment: "test",
    };
    render(
      <SilenceSubmitProgress
        cluster="am1"
        members={["am1"]}
        payload={payload}
        alertStore={alertStore}
        silenceFormStore={silenceFormStore}
      />,
    );
    render(
      <SilenceSubmitProgress
        cluster="am3"
        members={["am3"]}
        payload={payload}
        alertStore={alertStore}
        silenceFormStore={silenceFormStore}
      />,
    );

    await act(async () => {
      await fetchMock.callHistory.flush(true);
    });

    const calls = fetchMock.callHistory.calls();
    const existing = calls.find((c) => c?.url?.includes("am1:9093"));
    const added = calls.find((c) => c?.url?.includes("am3:9093"));
    expect(JSON.parse(existing?.options?.body as string).id).toBe(
      "silence-id-1",
    );
    expect(JSON.parse(added?.options?.body as string).id).toBeUndefined();
  });
});
