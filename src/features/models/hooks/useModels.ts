import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DebugEntry,
  ModelOption,
  ModelSelectionMode,
  WorkspaceInfo,
} from "../../../types";
import { getConfigModel, getModelList } from "../../../services/tauri";
import {
  normalizeEffortValue,
  parseModelListResponse,
} from "../utils/modelListResponse";
import { isBlacklistedModelSlug } from "../utils/modelBlacklist";

type UseModelsOptions = {
  activeWorkspace: WorkspaceInfo | null;
  onDebug?: (entry: DebugEntry) => void;
  preferredModelSelectionMode?: ModelSelectionMode;
  preferredModelId?: string | null;
  preferredEffort?: string | null;
  selectionKey?: string | null;
};

const CONFIG_MODEL_DESCRIPTION = "Configured in CODEX_HOME/config.toml";

const findModelByIdOrModel = (
  models: ModelOption[],
  idOrModel: string | null,
): ModelOption | null => {
  if (!idOrModel) {
    return null;
  }
  return (
    models.find((model) => model.id === idOrModel) ??
    models.find((model) => model.model === idOrModel) ??
    null
  );
};

const pickDefaultModel = (models: ModelOption[], configModel: string | null) =>
  findModelByIdOrModel(models, configModel) ??
  models.find((model) => model.isDefault) ??
  models[0] ??
  null;

export function useModels({
  activeWorkspace,
  onDebug,
  preferredModelSelectionMode = "manual",
  preferredModelId = null,
  preferredEffort = null,
  selectionKey = null,
}: UseModelsOptions) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [configModel, setConfigModel] = useState<string | null>(null);
  const [selectedModelSelectionMode, setSelectedModelSelectionModeState] =
    useState<ModelSelectionMode>("manual");
  const [selectedModelId, setSelectedModelIdState] = useState<string | null>(null);
  const [selectedEffort, setSelectedEffortState] = useState<string | null>(null);
  const lastFetchedWorkspaceId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const hasUserSelectedModel = useRef(false);
  const hasUserSelectedEffort = useRef(false);
  const selectedModelSelectionModeRef = useRef<ModelSelectionMode>("manual");
  const selectedModelIdRef = useRef<string | null>(null);
  const selectedEffortRef = useRef<string | null>(null);
  const lastWorkspaceId = useRef<string | null>(null);
  const lastSelectionKey = useRef<string | null>(null);

  const workspaceId = activeWorkspace?.id ?? null;
  const isConnected = Boolean(activeWorkspace?.connected);

  useEffect(() => {
    if (selectionKey === lastSelectionKey.current) {
      return;
    }
    lastSelectionKey.current = selectionKey;
    hasUserSelectedModel.current = false;
    hasUserSelectedEffort.current = false;
    setSelectedModelSelectionModeState(preferredModelSelectionMode);
    setSelectedModelIdState(
      preferredModelSelectionMode === "auto" ? null : preferredModelId,
    );
    setSelectedEffortState(
      preferredModelSelectionMode === "auto" ? null : preferredEffort,
    );
  }, [preferredEffort, preferredModelId, preferredModelSelectionMode, selectionKey]);

  useEffect(() => {
    if (workspaceId === lastWorkspaceId.current) {
      return;
    }
    hasUserSelectedModel.current = false;
    hasUserSelectedEffort.current = false;
    lastWorkspaceId.current = workspaceId;
    setConfigModel(null);
    setSelectedModelSelectionModeState(preferredModelSelectionMode);
    setSelectedModelIdState(
      preferredModelSelectionMode === "auto" ? null : preferredModelId,
    );
    setSelectedEffortState(
      preferredModelSelectionMode === "auto" ? null : preferredEffort,
    );
  }, [preferredEffort, preferredModelId, preferredModelSelectionMode, workspaceId]);

  useEffect(() => {
    selectedModelSelectionModeRef.current = selectedModelSelectionMode;
  }, [selectedModelSelectionMode]);

  useEffect(() => {
    if (selectedEffort === null) {
      return;
    }
    if (selectedEffort.trim().length > 0) {
      return;
    }
    hasUserSelectedEffort.current = false;
    setSelectedEffortState(null);
  }, [selectedEffort]);

  useEffect(() => {
    selectedModelIdRef.current = selectedModelId;
  }, [selectedModelId]);

  useEffect(() => {
    selectedEffortRef.current = selectedEffort;
  }, [selectedEffort]);

  const setSelectedEffort = useCallback((next: string | null) => {
    hasUserSelectedEffort.current = true;
    setSelectedEffortState(next);
  }, []);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );

  const reasoningSupported = useMemo(() => {
    if (!selectedModel) {
      return false;
    }
    return (
      selectedModel.supportedReasoningEfforts.length > 0 ||
      selectedModel.defaultReasoningEffort !== null
    );
  }, [selectedModel]);

  const reasoningOptions = useMemo(() => {
    const supported = selectedModel?.supportedReasoningEfforts.map(
      (effort) => effort.reasoningEffort,
    );
    if (supported && supported.length > 0) {
      return supported;
    }
    const defaultEffort = normalizeEffortValue(selectedModel?.defaultReasoningEffort);
    return defaultEffort ? [defaultEffort] : [];
  }, [selectedModel]);

  const resolveEffort = useCallback(
    (
      model: ModelOption,
      preferCurrent: boolean,
      currentSelectedEffort: string | null = selectedEffort,
    ) => {
      const supportedEfforts = model.supportedReasoningEfforts.map(
        (effort) => effort.reasoningEffort,
      );
      const currentEffort = normalizeEffortValue(currentSelectedEffort);
      if (preferCurrent && currentEffort) {
        return currentEffort;
      }
      if (supportedEfforts.length === 0) {
        return normalizeEffortValue(preferredEffort);
      }
      const preferred = normalizeEffortValue(preferredEffort);
      if (preferred && supportedEfforts.includes(preferred)) {
        return preferred;
      }
      return normalizeEffortValue(model.defaultReasoningEffort);
    },
    [preferredEffort, selectedEffort],
  );

  const setSelectedModelId = useCallback(
    (next: string | null) => {
      hasUserSelectedModel.current = true;
      setSelectedModelSelectionModeState(next === null ? "auto" : "manual");
      setSelectedModelIdState(next);

      if (next === null) {
        hasUserSelectedEffort.current = false;
        setSelectedEffortState(null);
        return;
      }

      const nextModel = findModelByIdOrModel(models, next);
      if (!nextModel) {
        return;
      }
      const nextEffort = resolveEffort(nextModel, hasUserSelectedEffort.current);
      if (nextEffort !== selectedEffort) {
        hasUserSelectedEffort.current = false;
        setSelectedEffortState(nextEffort);
      }
    },
    [models, resolveEffort, selectedEffort],
  );

  const refreshModels = useCallback(async () => {
    if (!workspaceId || !isConnected) {
      return;
    }
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    onDebug?.({
      id: `${Date.now()}-client-model-list`,
      timestamp: Date.now(),
      source: "client",
      label: "model/list",
      payload: { workspaceId },
    });
    try {
      const [modelListResult, configModelResult] = await Promise.allSettled([
        getModelList(workspaceId),
        getConfigModel(workspaceId),
      ]);
      const configModelFromConfig =
        configModelResult.status === "fulfilled"
          ? configModelResult.value
          : null;
      if (configModelResult.status === "rejected") {
        onDebug?.({
          id: `${Date.now()}-client-config-model-error`,
          timestamp: Date.now(),
          source: "error",
          label: "config/model error",
          payload:
            configModelResult.reason instanceof Error
              ? configModelResult.reason.message
              : String(configModelResult.reason),
        });
      }
      const response =
        modelListResult.status === "fulfilled" ? modelListResult.value : null;
      if (modelListResult.status === "rejected") {
        onDebug?.({
          id: `${Date.now()}-client-model-list-error`,
          timestamp: Date.now(),
          source: "error",
          label: "model/list error",
          payload:
            modelListResult.reason instanceof Error
              ? modelListResult.reason.message
              : String(modelListResult.reason),
        });
      }
      onDebug?.({
        id: `${Date.now()}-server-model-list`,
        timestamp: Date.now(),
        source: "server",
        label: "model/list response",
        payload: response,
      });
      setConfigModel(configModelFromConfig);
      const dataFromServer: ModelOption[] = parseModelListResponse(response);
      const data = (() => {
        if (!configModelFromConfig || isBlacklistedModelSlug(configModelFromConfig)) {
          return dataFromServer;
        }
        const hasConfigModel = dataFromServer.some(
          (model) => model.model === configModelFromConfig,
        );
        if (hasConfigModel) {
          return dataFromServer;
        }
        const configOption: ModelOption = {
          id: configModelFromConfig,
          model: configModelFromConfig,
          displayName: `${configModelFromConfig} (config)`,
          description: CONFIG_MODEL_DESCRIPTION,
          supportedReasoningEfforts: [],
          defaultReasoningEffort: null,
          isDefault: false,
        };
        return [configOption, ...dataFromServer];
      })();
      setModels(data);
      lastFetchedWorkspaceId.current = workspaceId;
      const defaultModel = pickDefaultModel(data, configModelFromConfig);
      const currentSelectionMode = selectedModelSelectionModeRef.current;
      const currentSelectedModelId = selectedModelIdRef.current;
      const currentSelectedEffort = selectedEffortRef.current;
      const existingSelection = findModelByIdOrModel(data, currentSelectedModelId);
      if (currentSelectedModelId && !existingSelection) {
        hasUserSelectedModel.current = false;
      }
      const preferredSelection = findModelByIdOrModel(data, preferredModelId);
      const shouldKeepExisting =
        hasUserSelectedModel.current &&
        (currentSelectionMode === "auto" || existingSelection !== null);
      const nextSelection = shouldKeepExisting
        ? currentSelectionMode === "auto"
          ? null
          : existingSelection
        : preferredModelSelectionMode === "auto"
          ? null
          : preferredSelection ?? defaultModel ?? existingSelection;
      if (nextSelection === null) {
        setSelectedModelSelectionModeState("auto");
        if (currentSelectedModelId !== null) {
          setSelectedModelIdState(null);
        }
        if (currentSelectedEffort !== null) {
          setSelectedEffortState(null);
        }
      } else {
        if (nextSelection.id !== currentSelectedModelId) {
          setSelectedModelIdState(nextSelection.id);
        }
        setSelectedModelSelectionModeState("manual");
        const nextEffort = resolveEffort(
          nextSelection,
          hasUserSelectedEffort.current,
          currentSelectedEffort,
        );
        if (nextEffort !== currentSelectedEffort) {
          setSelectedEffortState(nextEffort);
        }
      }
    } finally {
      inFlight.current = false;
    }
  }, [
    isConnected,
    onDebug,
    preferredModelSelectionMode,
    preferredModelId,
    resolveEffort,
    workspaceId,
  ]);

  useEffect(() => {
    if (!workspaceId || !isConnected) {
      return;
    }
    if (lastFetchedWorkspaceId.current === workspaceId && models.length > 0) {
      return;
    }
    refreshModels();
  }, [isConnected, models.length, refreshModels, workspaceId]);

  useEffect(() => {
    if (!selectedModel) {
      return;
    }
    const currentEffort = normalizeEffortValue(selectedEffort);
    if (currentEffort) {
      return;
    }
    const nextEffort = normalizeEffortValue(selectedModel.defaultReasoningEffort);
    if (nextEffort === null) {
      return;
    }
    hasUserSelectedEffort.current = false;
    setSelectedEffortState(nextEffort);
  }, [selectedEffort, selectedModel]);

  useEffect(() => {
    if (!models.length) {
      return;
    }
    const currentSelectionMode = selectedModelSelectionModeRef.current;
    const preferredSelection = findModelByIdOrModel(models, preferredModelId);
    const defaultModel = pickDefaultModel(models, configModel);
    const existingSelection = findModelByIdOrModel(models, selectedModelId);
    if (selectedModelId && !existingSelection) {
      hasUserSelectedModel.current = false;
    }
    const shouldKeepUserSelection =
      hasUserSelectedModel.current &&
      (currentSelectionMode === "auto" || existingSelection !== null);
    if (shouldKeepUserSelection) {
      return;
    }
    const nextSelection =
      preferredModelSelectionMode === "auto"
        ? null
        : preferredSelection ?? defaultModel ?? existingSelection ?? null;
    if (nextSelection === null) {
      setSelectedModelSelectionModeState("auto");
      if (selectedModelId !== null) {
        setSelectedModelIdState(null);
      }
      if (selectedEffort !== null) {
        setSelectedEffortState(null);
      }
      return;
    }
    if (nextSelection.id !== selectedModelId) {
      setSelectedModelIdState(nextSelection.id);
    }
    setSelectedModelSelectionModeState("manual");
    const nextEffort = resolveEffort(nextSelection, hasUserSelectedEffort.current);
    if (nextEffort !== selectedEffort) {
      setSelectedEffortState(nextEffort);
    }
  }, [
    configModel,
    models,
    preferredModelSelectionMode,
    preferredModelId,
    selectedEffort,
    selectedModelId,
    resolveEffort,
  ]);

  return {
    models,
    selectedModel,
    selectedModelSelectionMode,
    reasoningSupported,
    selectedModelId,
    setSelectedModelId,
    reasoningOptions,
    selectedEffort,
    setSelectedEffort,
    refreshModels,
  };
}
