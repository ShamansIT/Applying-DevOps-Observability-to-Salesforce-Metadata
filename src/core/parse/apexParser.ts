// Apex trigger static parse. Reads at header level (name, bound object, events) plus coarse symbol
// references in body. No full Apex parse - header carries phase-relevant facts and deeper parse adds
// cost without serving research question. Dynamic SOQL and dynamically built names cannot be
// resolved statically, so they are reported as reasons and surface later as `unresolved`. Pure;
// never throws - missing header comes back as captured error, since dropping component is worse.

// Trigger header: name, bound object, DML events as written.
export interface ApexTriggerHeader {
  name?: string;
  object?: string;
  events: string[]; // e.g. 'before update', 'after insert'
}

export interface ParsedApexTrigger {
  header: ApexTriggerHeader;
  symbolRefs: string[]; // coarse class-like references in body
  dynamic: string[]; // reasons a static reader cannot resolve (dynamic SOQL, dynamic type)
  errors: string[];
}

// Tokens that look class-like but are language or namespace built-ins, not participant references.
const SYMBOL_STOPLIST = new Set([
  'Trigger',
  'System',
  'Database',
  'Schema',
  'Test',
  'Math',
  'String',
  'Integer',
  'Boolean',
  'Decimal',
  'Double',
  'Long',
  'Date',
  'Datetime',
  'Time',
  'Id',
  'List',
  'Set',
  'Map',
  'SObject',
  'Object',
  'Type',
  'JSON',
  'Blob',
]);

// Dynamic-construct signals. Each match adds one reason; body that hits any becomes `unresolved`
// downstream with reason in evidence detail.
const DYNAMIC_SIGNALS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\bDatabase\.(query|getQueryLocator|countQuery)\s*\(/,
    reason: 'dynamic SOQL via Database query',
  },
  { pattern: /\bType\.forName\s*\(/, reason: 'dynamic type resolution via Type.forName' },
  { pattern: /\bgetGlobalDescribe\s*\(/, reason: 'dynamic describe via getGlobalDescribe' },
  { pattern: /\bcallable\b/i, reason: 'dynamic dispatch via Callable' },
];

// Remove block and line comments so string bodies do not feed false references.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

// Parse Apex trigger source. Returns header and coarse references; on missing header returns reason.
export function parseApexTrigger(src: string): ParsedApexTrigger {
  const body = stripComments(src);
  const errors: string[] = [];

  const header = /\btrigger\s+(\w+)\s+on\s+(\w+)\s*\(([^)]*)\)/i.exec(body);
  const parsedHeader: ApexTriggerHeader = { events: [] };
  if (header) {
    const name = header[1];
    const object = header[2];
    if (name !== undefined) parsedHeader.name = name;
    if (object !== undefined) parsedHeader.object = object;
    parsedHeader.events = (header[3] ?? '')
      .split(',')
      .map((event) => event.trim().toLowerCase().replace(/\s+/g, ' '))
      .filter((event) => event.length > 0);
  } else {
    errors.push('apex: no trigger header found');
  }

  const symbolRefs = [...new Set(collectSymbols(body))]
    .filter((symbol) => !SYMBOL_STOPLIST.has(symbol) && symbol !== parsedHeader.object)
    .sort();

  const dynamic: string[] = [];
  for (const { pattern, reason } of DYNAMIC_SIGNALS) {
    if (pattern.test(body)) {
      dynamic.push(reason);
    }
  }

  return { header: parsedHeader, symbolRefs, dynamic, errors };
}

// Coarse class-like tokens: `Foo.` member access and `new Foo(` construction.
function collectSymbols(body: string): string[] {
  const symbols: string[] = [];
  const member = /\b([A-Z][A-Za-z0-9_]*)\s*\./g;
  const construct = /\bnew\s+([A-Z][A-Za-z0-9_]*)\s*[(<]/g;
  for (const match of body.matchAll(member)) {
    if (match[1]) symbols.push(match[1]);
  }
  for (const match of body.matchAll(construct)) {
    if (match[1]) symbols.push(match[1]);
  }
  return symbols;
}
