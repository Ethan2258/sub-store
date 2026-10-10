import { useEnvApi } from "@/api/env";
import i18n from "@/locales";
import { useAppNotifyStore } from "@/store/appNotify";
import { useArtifactsStore } from "@/store/artifacts";
import { useGlobalStore } from "@/store/global";
import { useSettingsStore } from "@/store/settings";
import { useSubsStore } from "@/store/subs";

let activeInitialization: AbortController | undefined;

export const initStores = async (
  needNotify: boolean,
  needFetchFlow: boolean,
  needRefreshCache: boolean
) => {
  activeInitialization?.abort();
  const controller = new AbortController();
  const { signal } = controller;
  activeInitialization = controller;
  const isCurrent = () => activeInitialization === controller && !signal.aborted;

  const { showNotify } = useAppNotifyStore();
  const globalStore = useGlobalStore();
  const subsStore = useSubsStore();
  const artifactsStore = useArtifactsStore();
  const settingsStore = useSettingsStore();

  const { t } = i18n.global;
  let isSucceed = true;
  let flowsPromise: Promise<void> | undefined;
  if (needRefreshCache) {
    showNotify({ title: t("globalNotify.refresh.loading"), type: "primary" });
  }
  globalStore.setLoading(true);
  globalStore.setFetchResult(true);

  try {
    try {
      localStorage.removeItem("envCache");

      // Lists don't depend on the env check; start them together so the
      // page waits for one round trip instead of several in a row.
      const subsPromise = subsStore.fetchSubsData({ signal });

      const configuredTimeout = Number(localStorage.getItem("timeout"));
      const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 3000;
      const envController = new AbortController();
      const abortEnvRequest = () => envController.abort();
      signal.addEventListener("abort", abortEnvRequest, { once: true });
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            envController.abort();
            reject(new Error("Backend connection timeout"));
          }, timeoutMs);
        });
        await Promise.race([
          globalStore.setEnv({ signal: envController.signal }),
          timeoutPromise,
        ]);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        signal.removeEventListener("abort", abortEnvRequest);
      }

      if (!isCurrent()) return;
      const hasBackendEnv = Object.keys(globalStore.env).length > 0 && globalStore.env.backend;
      if (!hasBackendEnv) {
        globalStore.setFetchResult(false);
        isSucceed = false;
        throw new Error("Failed to get backend environment info");
      }

      await subsPromise;
      if (!isCurrent()) return;
      // Traffic only needs the subscription list, so it no longer waits for
      // sync configs and settings (the backend takes ~0.4s on settings).
      if (needFetchFlow) {
        flowsPromise = subsStore.fetchFlows(undefined, { signal }).catch((error) => {
          if (!signal.aborted) console.error("Error fetching flows:", error);
        });
      }
      await Promise.all([
        artifactsStore.fetchArtifactsData(signal),
        settingsStore.fetchSettings(signal),
      ]);
      if (!isCurrent()) return;
      await settingsStore.syncLocalAppearanceSetting({ signal });
      if (!isCurrent()) return;

      if (needRefreshCache) {
        const { data } = await useEnvApi().refreshCache(signal);
        if (!isCurrent()) return;
        if (data.status !== "success") {
          globalStore.setFetchResult(false);
          isSucceed = false;
        }
      }
    } catch (error) {
      if (!isCurrent()) return;
      console.error("Error initializing stores:", error);
      globalStore.setFetchResult(false);
      subsStore.subs = [];
      subsStore.collections = [];
      isSucceed = false;
    }

    if (!isCurrent()) return;
    if (isSucceed && needNotify) {
      showNotify({ title: t("globalNotify.refresh.succeed"), type: "primary" });
    }
    globalStore.setLoading(false);

    if (needFetchFlow) {
      await (flowsPromise ?? subsStore.fetchFlows(undefined, { signal }));
    }
  } finally {
    if (activeInitialization === controller) {
      globalStore.setLoading(false);
      activeInitialization = undefined;
    }
  }
};
