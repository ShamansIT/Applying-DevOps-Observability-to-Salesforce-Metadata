// Ingestion - read-only metadata sources: org snapshot capture, Tooling client,
// MetadataComponentDependency client, Flow and Apex parsers, local Salesforce DX project reader.
// Every call goes through read-only guard.
export * from './readOnlyGuard.js';
export * from './orgSnapshot.js';
export * from './dxProjectReader.js';
export * from './toolingClient.js';
export * from './captureSnapshot.js';
// Live @salesforce/core adapter (salesforceConnection.ts) is NOT re-exported, so importing this
// barrel does not pull in @salesforce/core.
