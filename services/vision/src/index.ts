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
  evaluateVisionDetections,
  runTwoStageShelfRecognition,
  visionEvalManifestSchema,
} from "./evaluation"
export type {
  EvalDetection,
  ShelfLocalizer,
  ShelfSkuRecognizer,
  VisionEvalManifest,
  VisionEvalMetrics,
} from "./evaluation"
