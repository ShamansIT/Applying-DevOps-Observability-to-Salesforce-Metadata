import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import type { MetadataComponent } from './orgSnapshot.js';

// What local Salesforce DX project yields: source API version and inventoried components.
export interface DxProjectContents {
  apiVersion: string | null;
  components: MetadataComponent[];
}

interface SfdxProject {
  packageDirectories?: { path: string }[];
  sourceApiVersion?: string;
}

// Read local Salesforce DX project as offline source - no network. object is set only where path
// encodes it (validation rules, object sub-trees); for triggers and flows parsers fill it later.
export function readDxProject(projectDir: string): DxProjectContents {
  const project = JSON.parse(
    readFileSync(join(projectDir, 'sfdx-project.json'), 'utf8'),
  ) as SfdxProject;
  const packageDirs = project.packageDirectories ?? [{ path: 'force-app' }];

  const components: MetadataComponent[] = [];
  for (const pkg of packageDirs) {
    for (const file of walk(join(projectDir, pkg.path))) {
      const component = classify(file, projectDir);
      if (component) {
        components.push(component);
      }
    }
  }
  // stable order - paths and fetch order must not leak into output
  components.sort((a, b) => a.type.localeCompare(b.type) || a.fullName.localeCompare(b.fullName));

  return { apiVersion: project.sourceApiVersion ?? null, components };
}

// Recursively list files under dir. Missing directory yields empty list.
function walk(dir: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

// Map source file to component, or null when it is not one we inventory.
function classify(file: string, projectDir: string): MetadataComponent | null {
  const path = relative(projectDir, file).split(sep).join('/');

  if (file.endsWith('.trigger')) {
    return { type: 'ApexTrigger', fullName: strip(file, '.trigger'), attributes: { path } };
  }
  if (file.endsWith('.cls')) {
    return { type: 'ApexClass', fullName: strip(file, '.cls'), attributes: { path } };
  }
  if (file.endsWith('.flow-meta.xml')) {
    return { type: 'Flow', fullName: strip(file, '.flow-meta.xml'), attributes: { path } };
  }
  if (file.endsWith('.validationRule-meta.xml')) {
    const object = objectFromPath(path);
    const ruleName = strip(file, '.validationRule-meta.xml');
    return {
      type: 'ValidationRule',
      fullName: object ? `${object}.${ruleName}` : ruleName,
      ...(object ? { object } : {}),
      attributes: { path },
    };
  }
  return null;
}

// Object name out of DX path like .../objects/<Object>/..., when present.
function objectFromPath(path: string): string | undefined {
  const parts = path.split('/');
  const index = parts.indexOf('objects');
  return index >= 0 ? parts[index + 1] : undefined;
}

function strip(file: string, suffix: string): string {
  const name = basename(file);
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}
