export type LabAsset = {
  file_name: string;
  file_type: string;
  file_path: string;
  content: string;
};

export type AssetPackInput = {
  category: string;
  difficulty: string;
  duration: string;
  title: string;
  generatedAt?: string;
  seed?: string;
  generationTime?: string;
  timezone?: string;
  assetAttempt?: number;
  narrativeAttempt?: number;
  taskAttempts?: Record<string, number>;
  featureFlags?: Record<string, boolean | string | number>;
};
