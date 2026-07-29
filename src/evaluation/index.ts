// Evaluation - procedure over structured prototype outputs. Depends on core; core never depends on
// this, so manualGroundTruth stays walled off from analysis. Scenario and ground-truth loaders,
// comparison, metrics, skeleton first-paint latency, procedural TTFAF, scenario runner, and
// calibration.
export * from './scenario.js';
export * from './groundTruth.js';
export * from './compare.js';
export * from './metrics.js';
export * from './latency.js';
export * from './ttfaf.js';
export * from './baseline.js';
export * from './runScenario.js';
export * from './runner.js';
export * from './calibration.js';
