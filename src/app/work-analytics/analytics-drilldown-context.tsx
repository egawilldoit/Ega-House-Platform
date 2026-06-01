"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import type { ExecutionEvidenceSessionRow } from "@/lib/services/execution-evidence-service";

export type DrilldownType =
  | "date"
  | "project"
  | "goal"
  | "task"
  | "none";

export type DrilldownData = {
  type: DrilldownType;
  label: string;
  sessions: ExecutionEvidenceSessionRow[];
};

type DrilldownContextValue = {
  drilldown: DrilldownData | null;
  openDrilldown: (data: DrilldownData) => void;
  closeDrilldown: () => void;
};

const DrilldownContext = createContext<DrilldownContextValue | null>(null);

export function useAnalyticsDrilldown() {
  const context = useContext(DrilldownContext);
  if (!context) {
    throw new Error(
      "useAnalyticsDrilldown must be used within AnalyticsDrilldownProvider",
    );
  }
  return context;
}

type AnalyticsDrilldownProviderProps = {
  children: ReactNode;
};

export function AnalyticsDrilldownProvider({
  children,
}: AnalyticsDrilldownProviderProps) {
  const [drilldown, setDrilldown] = useState<DrilldownData | null>(null);

  const openDrilldown = useCallback(
    (data: DrilldownData) => {
      setDrilldown(data);
    },
    [],
  );

  const closeDrilldown = useCallback(() => {
    setDrilldown(null);
  }, []);

  return (
    <DrilldownContext.Provider
      value={{
        drilldown,
        openDrilldown,
        closeDrilldown,
      }}
    >
      {children}
    </DrilldownContext.Provider>
  );
}
