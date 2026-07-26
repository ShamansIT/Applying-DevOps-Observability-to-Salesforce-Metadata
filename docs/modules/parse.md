# Parse

Static parsers read Salesforce source at header level and hand structured facts to reference
extraction. Header-level on purpose: it carries what phase classification and dependency extraction
need, and deeper parse adds cost without serving research question. Both parsers are pure and never
throw - parse failure is captured, not raised, since dropping component is worse for reviewer
than flagging one.

## Flow (`flowParser.ts`)

Reads Flow metadata XML. Validates first, then pulls start element, `triggerType`, bound object,
record-trigger type, entry-criteria presence, record references (create / update / lookup / delete),
subflow calls, and explicit trigger-order value. Trigger order is sanctioned intra-phase claim and
becomes `config_link` evidence. Malformed XML returns empty view with reason in `errors`.

## Apex (`apexParser.ts`)

Reads Apex trigger header (name, bound object, events) plus coarse symbol references in body, after
stripping comments so string bodies do not feed false references. No full Apex parse. Language and
namespace built-ins are dropped from references. Dynamic constructs - dynamic SOQL, `Type.forName`,
`getGlobalDescribe` - are reported as reasons, and surface downstream as `unresolved`. Missing header
returns reason in `errors`.

## Files

| File            | Responsibility                                                 |
| --------------- | -------------------------------------------------------------- |
| `flowParser.ts` | Flow XML to start element, references, subflows, order.        |
| `apexParser.ts` | Trigger header, coarse symbol refs, dynamic-construct reasons. |
