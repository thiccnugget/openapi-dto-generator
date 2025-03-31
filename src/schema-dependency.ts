import { OpenAPIDocument, OpenAPISchema } from './openapi-types';

// Helper function to extract schema references from a schema
function getSchemaRefs(schema: OpenAPISchema): Set<string> {
  const refs = new Set<string>();

  // Helper function to process a schema and collect refs
  function processSchema(s: OpenAPISchema) {
    if (s.$ref && s.$ref.startsWith('#/components/schemas/')) {
      refs.add(s.$ref.replace('#/components/schemas/', ''));
    }

    if (s.allOf) {
      s.allOf.forEach(processSchema);
    }

    if (s.properties) {
      Object.values(s.properties).forEach(processSchema);
    }

    if (s.items) {
      processSchema(s.items);
    }
  }

  processSchema(schema);
  return refs;
}

// Helper function to get parent classes from allOf and $ref
function getParentClasses(schema: OpenAPISchema): string[] {
  const parents: string[] = [];
  
  // Check direct $ref
  if (schema.$ref && schema.$ref.startsWith('#/components/schemas/')) {
    parents.push(schema.$ref.replace('#/components/schemas/', ''));
  }
  
  // Check allOf references
  if (schema.allOf) {
    for (const subSchema of schema.allOf) {
      if (subSchema.$ref && subSchema.$ref.startsWith('#/components/schemas/')) {
        parents.push(subSchema.$ref.replace('#/components/schemas/', ''));
      }
    }
  }
  
  return parents;
}

// Build a dependency graph for schemas
export function buildSchemaDependencyGraph(openApiDocument: OpenAPIDocument): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const schemas = openApiDocument.components?.schemas || {};

  // Initialize graph with empty dependency sets
  Object.keys(schemas).forEach(schemaName => {
    graph.set(schemaName, new Set<string>());
  });

  // Build dependencies
  Object.entries(schemas).forEach(([schemaName, schema]) => {
    const refs = getSchemaRefs(schema);
    const parents = getParentClasses(schema);
    
    // Add both direct references and parent classes as dependencies
    const allDeps = new Set([...refs, ...parents]);
    graph.set(schemaName, allDeps);
  });

  return graph;
}

// Sort schemas by dependency (topological sort with cycle detection)
export function sortSchemasByDependency(graph: Map<string, Set<string>>): string[] {
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const cycles = new Set<string>();

  function visit(node: string, path: Set<string> = new Set()): void {
    if (visited.has(node)) return;
    if (visiting.has(node)) {
      // We've found a cycle, mark all nodes in the cycle
      path.forEach(n => cycles.add(n));
      return;
    }

    visiting.add(node);
    path.add(node);

    const dependencies = graph.get(node) || new Set();
    for (const dep of dependencies) {
      if (!visited.has(dep)) {
        visit(dep, new Set(path));
      }
    }

    path.delete(node);
    visiting.delete(node);
    visited.add(node);
    sorted.unshift(node);
  }

  // First pass: detect cycles and mark affected nodes
  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      visit(node);
    }
  }

  // Reset visited sets for the second pass
  visited.clear();
  visiting.clear();

  // Second pass: sort nodes, handling cycles appropriately
  const finalSorted: string[] = [];
  const processed = new Set<string>();

  // Helper function to process a node and its dependencies
  function processNode(node: string) {
    if (processed.has(node)) return;
    
    const dependencies = graph.get(node) || new Set();
    
    // Process non-cyclic dependencies first
    for (const dep of dependencies) {
      if (!cycles.has(dep)) {
        processNode(dep);
      }
    }
    
    // Process cyclic dependencies
    for (const dep of dependencies) {
      if (cycles.has(dep) && !processed.has(dep)) {
        finalSorted.push(dep);
        processed.add(dep);
      }
    }
    
    // Add the current node
    finalSorted.push(node);
    processed.add(node);
  }

  // Process all nodes
  for (const node of sorted) {
    processNode(node);
  }

  return finalSorted;
}

// Helper function to get properties from a schema that aren't in parent classes
export function getNonParentProperties(schema: OpenAPISchema, openApiDocument: OpenAPIDocument): OpenAPISchema {
  if (!schema.allOf) {
    return schema;
  }

  // Get all properties from parent classes
  const parentProps = new Set<string>();
  schema.allOf.forEach(subSchema => {
    if (subSchema.$ref) {
      const refSchema = resolveRef(subSchema.$ref, openApiDocument);
      if (refSchema) {
        if (refSchema.properties) {
          Object.keys(refSchema.properties).forEach(prop => parentProps.add(prop));
        }
      }
    }
  });

  // Get the properties specific to this schema (from the last allOf entry)
  const ownProperties = schema.allOf[schema.allOf.length - 1].properties || {};

  // Create a new schema with only non-parent properties
  const nonParentSchema: OpenAPISchema = {
    type: 'object',
    properties: {}
  };

  Object.entries(ownProperties).forEach(([propName, propSchema]) => {
    if (!parentProps.has(propName)) {
      nonParentSchema.properties![propName] = propSchema;
    }
  });

  return nonParentSchema;
}

// Helper function to resolve $ref
export function resolveRef(ref: string, openApiDocument: OpenAPIDocument): OpenAPISchema | null {
  if (!ref.startsWith('#/components/schemas/')) {
    return null;
  }
  
  const schemaName = ref.replace('#/components/schemas/', '');
  const schema = openApiDocument.components?.schemas?.[schemaName];
  
  // If the referenced schema is a primitive type or enum, return it directly
  if (schema && (
    schema.type === 'string' || 
    schema.type === 'number' || 
    schema.type === 'integer' || 
    schema.type === 'boolean' ||
    Array.isArray(schema.enum)
  )) {
    return {
      ...schema,
      title: schemaName // Store the original name for enum handling
    };
  }
  
  return schema || null;
}

// Helper function to check if a schema is an enum
export function isEnumSchema(schema: OpenAPISchema): boolean {
  return schema.type === 'string' && Array.isArray(schema.enum) && schema.enum.length > 0;
}

// Helper function to get all enums from a schema
export function getEnums(openApiDocument: OpenAPIDocument): Map<string, string[]> {
  const enums = new Map<string, string[]>();
  
  if (openApiDocument.components?.schemas) {
    Object.entries(openApiDocument.components.schemas).forEach(([name, schema]) => {
      if (isEnumSchema(schema)) {
        enums.set(name, schema.enum!);
      }
    });
  }
  
  return enums;
}