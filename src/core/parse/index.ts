// Static parsers. Header-level read of Flow XML and Apex triggers, feeding reference extraction.
// Pure, and never throw - parse failure is captured, not raised.
export * from './flowParser.js';
export * from './apexParser.js';
