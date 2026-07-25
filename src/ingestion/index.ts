// Ingestion - read-only metadata sources: org snapshot capture, Tooling client,
// MetadataComponentDependency client, Flow and Apex parsers, and local Salesforce DX
// project reader. Every call goes through the read-only guard.
export * from './readOnlyGuard.js';
