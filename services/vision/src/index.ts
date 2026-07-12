export {
  createConfiguredSkuRecognizer,
  createConfiguredVisionProvider,
  DEFAULT_OPENAI_VISION_MODEL,
  GeminiSkuRecognizer,
  OpenAiSkuRecognizer,
  OpenAiVisionProvider,
  OPENAI_PROVIDER,
  ReferenceSlotStubProvider,
  STUB_MODEL_VERSION,
  STUB_PROVIDER,
  STUB_SKU_RECOGNIZER_MODEL_VERSION,
  StubShelfSkuRecognizer,
} from "./provider"
export type {
  GeminiSkuRecognizerConfig,
  OpenAiSkuRecognizerConfig,
  OpenAiVisionProviderConfig,
  ShelfSkuRecognizerWithWarnings,
  SkuRecognitionDetailedResult,
  SkuRecognizerAssignment,
  SkuRecognizerBoxInput,
  VisionFetch,
  VisionProvider,
} from "./provider"
export {
  evaluateVisionDataset,
  evaluateVisionDetections,
  runTwoStageShelfRecognition,
  validateVisionEvalManifest,
  visionEvalAnnotationSchema,
  visionEvalManifestSchema,
  visionEvalManifestStats,
} from "./evaluation"
export type {
  EvalDetection,
  ShelfLocalizer,
  ShelfSkuRecognizer,
  VisionEvalDatasetSample,
  VisionEvalManifest,
  VisionEvalManifestStats,
  VisionEvalMetrics,
  VisionEvalSplit,
} from "./evaluation"
export {
  addSampleToManifest,
  assignSplitDeterministically,
  datasetAnnotationsFileSchema,
  DEFAULT_SPLIT_RATIOS,
  parseSplitRatios,
} from "./dataset"
export type { AddSampleInput, AddSampleResult, SplitRatios } from "./dataset"
export {
  runVisionEval,
  type RunVisionEvalInput,
  type VisionEvalMode,
  type VisionEvalRunReport,
  type VisionEvalSampleReport,
  type VisionEvalThresholdReport,
} from "./eval-runner"
export {
  appleVisionOcrRowsSchema,
  evaluateAppleVisionOcr,
  type AppleVisionOcrEvalReport,
  type AppleVisionOcrEvidenceMetrics,
  type AppleVisionOcrRow,
  type EvaluateAppleVisionOcrInput,
} from "./apple-vision-ocr-eval"
