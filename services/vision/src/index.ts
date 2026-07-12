export {
  createConfiguredVisionProvider,
  DEFAULT_OPENAI_VISION_MODEL,
  OpenAiVisionProvider,
  OPENAI_PROVIDER,
  ReferenceSlotStubProvider,
  STUB_MODEL_VERSION,
  STUB_PROVIDER,
} from "./provider"
export type { OpenAiVisionProviderConfig, VisionFetch, VisionProvider } from "./provider"
export {
  evaluateVisionDataset,
  evaluateVisionDetections,
  runTwoStageShelfRecognition,
  visionEvalManifestSchema,
} from "./evaluation"
export type {
  EvalDetection,
  ShelfLocalizer,
  ShelfSkuRecognizer,
  VisionEvalDatasetSample,
  VisionEvalManifest,
  VisionEvalMetrics,
} from "./evaluation"
export {
  runVisionEval,
  type RunVisionEvalInput,
  type VisionEvalRunReport,
  type VisionEvalSampleReport,
  type VisionEvalThresholdReport,
} from "./eval-runner"
