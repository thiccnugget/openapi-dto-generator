import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { OpenAPIDocument, OpenAPISchema, OpenAPIResponse } from './openapi-types';
import { buildSchemaDependencyGraph, sortSchemasByDependency, getNonParentProperties, resolveRef, isEnumSchema, getEnums } from './schema-dependency';

// Map to store original schema names to generated class names
const schemaToClassName = new Map<string, string>();

// Helper function to parse OpenAPI file (JSON or YAML)
function parseOpenAPIFile(filePath: string): OpenAPIDocument {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();

  try {
    if (ext === '.yaml' || ext === '.yml') {
      return yaml.load(content) as OpenAPIDocument;
    } else {
      return JSON.parse(content);
    }
  } catch (error) {
    throw new Error(`Failed to parse OpenAPI file: ${error}`);
  }
}

// Helper function to convert snake_case or kebab-case to PascalCase
function toPascalCase(str: string): string {
  return str
    .replace(/[-_]([a-z])/g, (g) => g[1].toUpperCase())
    .replace(/^([a-z])/, (g) => g.toUpperCase());
}

// Helper function to check if a string needs to be quoted
function needsQuotes(str: string): boolean {
  return /[^a-zA-Z0-9_]/.test(str);
}

// Helper function to get a valid class name from an operation ID
function getClassNameFromOperationId(operationId: string, statusCode: string, usedNames: Set<string>): string {
  const baseClassName = `${toPascalCase(operationId)}${statusCode}Response`;
  
  if (!usedNames.has(baseClassName)) {
    usedNames.add(baseClassName);
    return baseClassName;
  }
  
  // If name is taken, try adding descriptive suffixes
  const suffixes = ['Detail', 'Extended', 'Full', 'Complete', 'Info'];
  for (const suffix of suffixes) {
    const newName = `${baseClassName}${suffix}`;
    if (!usedNames.has(newName)) {
      usedNames.add(newName);
      return newName;
    }
  }
  
  // If all attempts fail, make it unique with a UUID-like suffix
  const uniqueSuffix = Math.random().toString(36).substring(2, 8);
  const fallbackName = `${baseClassName}_${uniqueSuffix}`;
  usedNames.add(fallbackName);
  return fallbackName;
}

// Helper function to get a valid class name from a schema name
function getClassNameFromSchemaName(schemaName: string, usedNames: Set<string>): string {
  // If we've already generated a name for this schema, return it
  if (schemaToClassName.has(schemaName)) {
    return schemaToClassName.get(schemaName)!;
  }

  // Use the exact schema name if it's not already taken
  if (!usedNames.has(schemaName)) {
    usedNames.add(schemaName);
    schemaToClassName.set(schemaName, schemaName);
    return schemaName;
  }

  // If the exact name is taken, use PascalCase version
  const pascalName = toPascalCase(schemaName);
  if (!usedNames.has(pascalName)) {
    usedNames.add(pascalName);
    schemaToClassName.set(schemaName, pascalName);
    return pascalName;
  }

  // If PascalCase is taken, try descriptive suffixes
  const suffixes = ['Model', 'Type', 'Entity', 'Object', 'Data'];
  for (const suffix of suffixes) {
    const newName = `${pascalName}${suffix}`;
    if (!usedNames.has(newName)) {
      usedNames.add(newName);
      schemaToClassName.set(schemaName, newName);
      return newName;
    }
  }

  // If all attempts fail, make it unique with a UUID-like suffix
  const uniqueSuffix = Math.random().toString(36).substring(2, 8);
  const fallbackName = `${pascalName}_${uniqueSuffix}`;
  usedNames.add(fallbackName);
  schemaToClassName.set(schemaName, fallbackName);
  return fallbackName;
}

// Helper function to get a valid enum name from a property name and context
function getEnumNameFromProperty(propertyName: string, enumValues: any[], context: string, usedEnums: Map<string, string[]>): string {
  // Create a unique key for the enum values
  const enumKey = JSON.stringify(enumValues.sort());
  
  // Check if we already have an enum with these exact values
  for (const [existingName, existingValues] of usedEnums.entries()) {
    if (JSON.stringify(existingValues.sort()) === enumKey) {
      return existingName;
    }
  }
  
  // If not found, create a new enum name
  let baseName = '';
  if (propertyName.toLowerCase() === 'currency') {
    baseName = 'Currency';
  } else if (propertyName.toLowerCase() === 'status') {
    baseName = `${toPascalCase(context)}Status`;
  } else {
    baseName = `${toPascalCase(context)}${toPascalCase(propertyName)}`;
  }
  
  if (!usedEnums.has(baseName)) {
    usedEnums.set(baseName, enumValues);
    return baseName;
  }
  
  // If name is taken, try adding descriptive suffixes
  const suffixes = ['Type', 'Enum', 'Values', 'Options', 'List'];
  for (const suffix of suffixes) {
    const newName = `${baseName}${suffix}`;
    if (!usedEnums.has(newName)) {
      usedEnums.set(newName, enumValues);
      return newName;
    }
  }
  
  // If all attempts fail, make it unique with a UUID-like suffix
  const uniqueSuffix = Math.random().toString(36).substring(2, 8);
  const fallbackName = `${baseName}_${uniqueSuffix}`;
  usedEnums.set(fallbackName, enumValues);
  return fallbackName;
}

// Helper function to generate class-validator decorators based on schema properties
function generateDecorators(schema: OpenAPISchema, propertyName: string, isRequired: boolean = true): string[] {
  const decorators: string[] = [];
  
  if (!isRequired) {
    decorators.push('@IsOptional()');
  }
  
  // Special case for common property names
  const lowerPropertyName = propertyName.toLowerCase();
  if (lowerPropertyName === 'latitude') {
    decorators.push('@IsLatitude()');
    return decorators;
  } else if (lowerPropertyName === 'longitude') {
    decorators.push('@IsLongitude()');
    return decorators;
  } else if (lowerPropertyName === 'email' || lowerPropertyName.includes('email')) {
    decorators.push('@IsEmail()');
    return decorators;
  } else if (lowerPropertyName === 'creditcard' || lowerPropertyName.includes('credit_card') || lowerPropertyName.includes('creditcard')) {
    decorators.push('@IsCreditCard()');
    return decorators;
  } else if (lowerPropertyName === 'phone' || lowerPropertyName.includes('phone')) {
    decorators.push('@IsPhoneNumber()');
    return decorators;
  } else if (lowerPropertyName === 'postalcode' || lowerPropertyName.includes('postal_code') || lowerPropertyName.includes('zip')) {
    decorators.push('@IsPostalCode()');
    return decorators;
  } else if (lowerPropertyName === 'uuid' || lowerPropertyName.includes('uuid')) {
    decorators.push('@IsUUID()');
    return decorators;
  } else if (lowerPropertyName === 'url' || lowerPropertyName.includes('url')) {
    decorators.push('@IsUrl()');
    return decorators;
  } else if (lowerPropertyName === 'ip' || lowerPropertyName.includes('ip_address')) {
    decorators.push('@IsIP()');
    return decorators;
  } else if (lowerPropertyName === 'mongodb' || lowerPropertyName.includes('mongo_id') || lowerPropertyName === 'objectid') {
    decorators.push('@IsMongoId()');
    return decorators;
  }
  
  if (schema.type === 'string') {
    if (schema.format === 'date' || schema.format === 'date-time') {
      decorators.push('@IsDate()');
      decorators.push('@Transform(({ value }) => value ? new Date(value) : value)');
    } else {
      decorators.push('@IsString()');
      
      if (schema.minLength !== undefined) {
        decorators.push(`@MinLength(${schema.minLength})`);
      }
      
      if (schema.maxLength !== undefined) {
        decorators.push(`@MaxLength(${schema.maxLength})`);
      }
      
      if (schema.pattern) {
        decorators.push(`@Matches(/${schema.pattern}/)`);
      }
      
      if (schema.format) {
        switch (schema.format) {
          case 'email':
            decorators.push('@IsEmail()');
            break;
          case 'uri':
          case 'url':
            decorators.push('@IsUrl()');
            break;
          case 'uuid':
            decorators.push('@IsUUID()');
            break;
          case 'ipv4':
          case 'ipv6':
            decorators.push('@IsIP()');
            break;
        }
      }
    }
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (schema.type === 'integer') {
      decorators.push('@IsInt()');
    } else {
      decorators.push('@IsNumber()');
    }
    
    if (schema.minimum !== undefined) {
      if (schema.minimum === 0) {
        decorators.push('@IsPositive()');
      } else {
        decorators.push(`@Min(${schema.minimum})`);
      }
    }
    
    if (schema.maximum !== undefined) {
      if (schema.maximum === 0) {
        decorators.push('@IsNegative()');
      } else {
        decorators.push(`@Max(${schema.maximum})`);
      }
    }
  } else if (schema.type === 'boolean') {
    decorators.push('@IsBoolean()');
  } else if (schema.type === 'array' && schema.items) {
    decorators.push('@IsArray()');
    decorators.push('@ValidateNested({ each: true })');
    decorators.push('@Type(() => PLACEHOLDER)'); // This will be replaced later
  } else if (schema.type === 'object' || schema.properties) {
    decorators.push('@IsObject()');
    decorators.push('@ValidateNested()');
    decorators.push('@Type(() => PLACEHOLDER)'); // This will be replaced later
  }
  
  return decorators;
}

function getAllParentClasses(schema: OpenAPISchema, openApiDocument: OpenAPIDocument): string[] {
  const parents: string[] = [];
  
  if (schema.allOf) {
    for (const subSchema of schema.allOf) {
      if (subSchema.$ref && subSchema.$ref.startsWith('#/components/schemas/')) {
        const parentName = subSchema.$ref.replace('#/components/schemas/', '');
        parents.push(parentName);
        
        // Recursively get parents of parent
        const parentSchema = openApiDocument.components?.schemas?.[parentName];
        if (parentSchema) {
          parents.push(...getAllParentClasses(parentSchema, openApiDocument));
        }
      }
    }
  }
  
  return [...new Set(parents)]; // Remove duplicates
}

// Helper function to generate class property with decorators
function generateClassProperty(
  propertyName: string,
  schema: OpenAPISchema,
  required: string[] = [],
  classMap: Map<string, string>,
  openApiDocument: OpenAPIDocument,
  usedNames: Set<string>,
  usedProperties: Set<string>,
  context: string = '',
  usedEnums: Map<string, string[]> = new Map()
): { property: string; nestedClasses: string[]; enums: string[] } {
  const isRequired = required.includes(propertyName);
  const decorators = generateDecorators(schema, propertyName, isRequired);
  const nestedClasses: string[] = [];
  const enums: string[] = [];
  
  // Handle duplicate property names
  let uniquePropertyName = propertyName;
  let counter = 1;
  while (usedProperties.has(uniquePropertyName)) {
    uniquePropertyName = `${propertyName}${counter}`;
    counter++;
  }
  usedProperties.add(uniquePropertyName);
  
  // Check if property name needs quotes
  const formattedPropertyName = needsQuotes(propertyName) ? `'${propertyName}'` : propertyName;
  
  let propertyType = 'any';
  
  // Resolve $ref if present
  if (schema.$ref) {
    const refSchema = resolveRef(schema.$ref, openApiDocument);
    if (refSchema) {
      const refName = schema.$ref.replace('#/components/schemas/', '');
      const className = getClassNameFromSchemaName(refName, usedNames);
      propertyType = className;

      if (refSchema.enum) {
        decorators.push(`@IsEnum(${className})`);
      }
      
      // Replace the PLACEHOLDER in the @Type decorator if needed
      const typeDecoratorIndex = decorators.findIndex(d => d.includes('PLACEHOLDER'));
      if (typeDecoratorIndex !== -1) {
        decorators[typeDecoratorIndex] = decorators[typeDecoratorIndex].replace('PLACEHOLDER', className);
      }
      
      return { 
        property: `  ${decorators.join('\n  ')}\n  ${formattedPropertyName}${!isRequired ? '?' : ''}: ${propertyType};\n`,
        nestedClasses,
        enums
      };
    }
  }
  
  if (schema.type === 'string') {
    if (schema.format === 'date' || schema.format === 'date-time') {
      propertyType = 'Date';
    } else {
      propertyType = 'string';
    }
    
    if (schema.enum) {
      const enumName = getEnumNameFromProperty(propertyName, schema.enum, context, usedEnums);
      const enumValues = schema.enum.map(v => typeof v === 'string' ? `'${v}'` : v).join(' | ');
      const enumDefinition = `export enum ${enumName} { 
  ${schema.enum.map((v, i) => {
    const enumKey = typeof v === 'string' 
      ? v.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase() 
      : `VALUE_${i}`;
    return `${enumKey} = ${typeof v === 'string' ? `'${v}'` : v}`;
  }).join(',\n  ')} 
}`;
      enums.push(enumDefinition);
      propertyType = enumName;
      
      // Add IsEnum decorator
      decorators.push(`@IsEnum(${enumName})`);
    }
  } else if (schema.type === 'number' || schema.type === 'integer') {
    propertyType = 'number';
  } else if (schema.type === 'boolean') {
    propertyType = 'boolean';
  } else if (schema.type === 'array' && schema.items) {
    const nestedClassName = getClassNameFromSchemaName(`${propertyName}Item`, usedNames);
    
    // Handle $ref in array items
    if (schema.items.$ref) {
      const refSchema = resolveRef(schema.items.$ref, openApiDocument);
      if (refSchema) {
        const refName = schema.items.$ref.replace('#/components/schemas/', '');
        const refClassName = getClassNameFromSchemaName(refName, usedNames);
        
        // Replace the PLACEHOLDER in the @Type decorator
        const typeDecoratorIndex = decorators.findIndex(d => d.includes('PLACEHOLDER'));
        if (typeDecoratorIndex !== -1) {
          decorators[typeDecoratorIndex] = decorators[typeDecoratorIndex].replace('PLACEHOLDER', refClassName);
        }
        
        propertyType = `${refClassName}[]`;
        return {
          property: `  ${decorators.join('\n  ')}\n  ${formattedPropertyName}${!isRequired ? '?' : ''}: ${propertyType};\n`,
          nestedClasses,
          enums
        };
      }
    }
    
    // Generate a class for the array items if it has properties
    if (schema.items.properties) {
      const nestedClassProperties = generateClassProperties(
        schema.items,
        [],
        classMap,
        openApiDocument,
        usedNames,
        context,
        usedEnums
      );
      
      if (nestedClassProperties.properties.length > 0) {
        const nestedClass = `
export class ${nestedClassName} {
${nestedClassProperties.properties.join('\n')}
}`;
        
        nestedClasses.push(...nestedClassProperties.nestedClasses);
        enums.push(...nestedClassProperties.enums);
        nestedClasses.push(nestedClass);
        classMap.set(`${propertyName}.items`, nestedClassName);
        
        // Replace the PLACEHOLDER in the @Type decorator
        const typeDecoratorIndex = decorators.findIndex(d => d.includes('PLACEHOLDER'));
        if (typeDecoratorIndex !== -1) {
          decorators[typeDecoratorIndex] = decorators[typeDecoratorIndex].replace('PLACEHOLDER', nestedClassName);
        }
        
        propertyType = `${nestedClassName}[]`;
      } else {
        // If the item schema has no properties, use a simple type
        if (schema.items.type === 'string') {
          decorators.push('@IsString({ each: true })');
          propertyType = 'string[]';
        } else if (schema.items.type === 'number' || schema.items.type === 'integer') {
          decorators.push('@IsNumber({}, { each: true })');
          propertyType = 'number[]';
        } else if (schema.items.type === 'boolean') {
          decorators.push('@IsBoolean({ each: true })');
          propertyType = 'boolean[]';
        } else {
          propertyType = 'any[]';
        }
        
        // Remove the @ValidateNested and @Type decorators
        const validateNestedIndex = decorators.findIndex(d => d.includes('@ValidateNested'));
        if (validateNestedIndex !== -1) {
          decorators.splice(validateNestedIndex, 1);
        }
        
        const typeDecoratorIndex = decorators.findIndex(d => d.includes('@Type'));
        if (typeDecoratorIndex !== -1) {
          decorators.splice(typeDecoratorIndex, 1);
        }
      }
    } else {
      // If the item schema has no properties, use a simple type
      if (schema.items.type === 'string') {
        decorators.push('@IsString({ each: true })');
        propertyType = 'string[]';
      } else if (schema.items.type === 'number' || schema.items.type === 'integer') {
        decorators.push('@IsNumber({}, { each: true })');
        propertyType = 'number[]';
      } else if (schema.items.type === 'boolean') {
        decorators.push('@IsBoolean({ each: true })');
        propertyType = 'boolean[]';
      } else {
        propertyType = 'any[]';
      }
      
      // Remove the @ValidateNested and @Type decorators
      const validateNestedIndex = decorators.findIndex(d => d.includes('@ValidateNested'));
      if (validateNestedIndex !== -1) {
        decorators.splice(validateNestedIndex, 1);
      }
      
      const typeDecoratorIndex = decorators.findIndex(d => d.includes('@Type'));
      if (typeDecoratorIndex !== -1) {
        decorators.splice(typeDecoratorIndex, 1);
      }
    }
  } else if (schema.type === 'object' || schema.properties) {
    const nestedClassName = getClassNameFromSchemaName(`${propertyName}Object`, usedNames);
    
    // Generate a class for the nested object if it has properties
    if (schema.properties) {
      const nestedClassProperties = generateClassProperties(
        schema,
        [],
        classMap,
        openApiDocument,
        usedNames,
        context,
        usedEnums
      );
      
      if (nestedClassProperties.properties.length > 0) {
        const nestedClass = `
export class ${nestedClassName} {
${nestedClassProperties.properties.join('\n')}
}`;
        
        nestedClasses.push(...nestedClassProperties.nestedClasses);
        enums.push(...nestedClassProperties.enums);
        nestedClasses.push(nestedClass);
        classMap.set(propertyName, nestedClassName);
        
        // Replace the PLACEHOLDER in the @Type decorator
        const typeDecoratorIndex = decorators.findIndex(d => d.includes('PLACEHOLDER'));
        if (typeDecoratorIndex !== -1) {
          decorators[typeDecoratorIndex] = decorators[typeDecoratorIndex].replace('PLACEHOLDER', nestedClassName);
        }
        
        propertyType = nestedClassName;
      } else {
        // If the object schema has no properties, use Record<string, any>
        propertyType = 'Record<string, any>';
        
        // Remove the @ValidateNested and @Type decorators
        const validateNestedIndex = decorators.findIndex(d => d.includes('@ValidateNested'));
        if (validateNestedIndex !== -1) {
          decorators.splice(validateNestedIndex, 1);
        }
        
        const typeDecoratorIndex = decorators.findIndex(d => d.includes('@Type'));
        if (typeDecoratorIndex !== -1) {
          decorators.splice(typeDecoratorIndex, 1);
        }
      }
    } else {
      // If the object schema has no properties, use Record<string, any>
      propertyType = 'Record<string, any>';
      
      // Remove the @ValidateNested and @Type decorators
      const validateNestedIndex = decorators.findIndex(d => d.includes('@ValidateNested'));
      if (validateNestedIndex !== -1) {
        decorators.splice(validateNestedIndex, 1);
      }
      
      const typeDecoratorIndex = decorators.findIndex(d => d.includes('@Type'));
      if (typeDecoratorIndex !== -1) {
        decorators.splice(typeDecoratorIndex, 1);
      }
    }
  }
  
  const property = `  ${decorators.join('\n  ')}
  ${formattedPropertyName}${!isRequired ? '?' : ''}: ${propertyType};
`;
  
  return { property, nestedClasses, enums };
}

function mergeParentProperties(
  schema: OpenAPISchema,
  openApiDocument: OpenAPIDocument,
  usedNames: Set<string>,
  context: string
): { properties: OpenAPISchema['properties']; required: string[] } {
  const mergedProperties: OpenAPISchema['properties'] = {};
  const mergedRequired: string[] = [];
  
  if (schema.allOf) {
    for (const subSchema of schema.allOf) {
      if (subSchema.$ref) {
        const parentSchema = resolveRef(subSchema.$ref, openApiDocument);
        if (parentSchema) {
          // Recursively merge parent properties
          const { properties: parentProps, required: parentRequired } = mergeParentProperties(
            parentSchema,
            openApiDocument,
            usedNames,
            context
          );
          
          Object.assign(mergedProperties, parentProps);
          mergedRequired.push(...(parentRequired || []));
        }
      } else {
        // Direct properties in allOf
        Object.assign(mergedProperties, subSchema.properties);
        if (subSchema.required) {
          mergedRequired.push(...subSchema.required);
        }
      }
    }
  }
  
  // Add own properties
  if (schema.properties) {
    Object.assign(mergedProperties, schema.properties);
  }
  if (schema.required) {
    mergedRequired.push(...schema.required);
  }
  
  return {
    properties: mergedProperties,
    required: [...new Set(mergedRequired)] // Remove duplicates
  };
}

// Helper function to generate class properties from a schema
function generateClassProperties(
  schema: OpenAPISchema,
  required: string[] = [],
  classMap: Map<string, string> = new Map(),
  openApiDocument: OpenAPIDocument,
  usedNames: Set<string>,
  context: string = '',
  usedEnums: Map<string, string[]> = new Map()
): { properties: string[]; nestedClasses: string[]; enums: string[] } {
  const properties: string[] = [];
  const nestedClasses: string[] = [];
  const enums: string[] = [];
  const usedProperties = new Set<string>();
  
  // Get merged properties from all parents
  const { properties: mergedProperties, required: mergedRequired } = mergeParentProperties(
    schema,
    openApiDocument,
    usedNames,
    context
  );
  
  if (mergedProperties) {
    for (const [propertyName, propertySchema] of Object.entries(mergedProperties)) {
      const { property, nestedClasses: propNestedClasses, enums: propEnums } = generateClassProperty(
        propertyName,
        propertySchema,
        mergedRequired || required,
        classMap,
        openApiDocument,
        usedNames,
        usedProperties,
        context,
        usedEnums
      );
      
      if (property) {
        properties.push(property);
        nestedClasses.push(...propNestedClasses);
        enums.push(...propEnums);
      }
    }
  }
  
  return { properties, nestedClasses, enums };
}

// Main function to generate classes from OpenAPI document
export function generateClassesFromOpenAPI(openApiFilePath: string, outputFilePath: string): void {
  // Clear the schema to class name map before starting
  schemaToClassName.clear();

  // Read and parse the OpenAPI document
  const openApiDocument = parseOpenAPIFile(openApiFilePath);
  
  let output = `import {
  IsString,
  IsNumber,
  IsBoolean,
  IsDate,
  IsArray,
  IsObject,
  ValidateNested,
  IsOptional,
  IsEnum,
  Min,
  Max,
  MinLength,
  MaxLength,
  Matches,
  IsEmail,
  IsUrl,
  IsIP,
  IsUUID,
  IsLatitude,
  IsLongitude,
  IsCreditCard,
  IsPhoneNumber,
  IsPostalCode,
  IsMongoId,
  IsInt,
  IsPositive,
  IsNegative,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

`;
  
  const baseClasses: string[] = [];
  const childClasses: string[] = [];
  const generatedEnums: string[] = [];
  const classMap = new Map<string, string>();
  const processedSchemas = new Set<string>();
  const usedNames = new Set<string>();
  const usedEnums = new Map<string, string[]>();
  
  // Process enums first
  const enumSchemas = getEnums(openApiDocument);
  for (const [enumName, enumValues] of enumSchemas) {
    const enumDefinition = `export enum ${enumName} {
  ${enumValues.map((v, i) => {
    const enumKey = typeof v === 'string'
      ? v.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase()
      : `VALUE_${i}`;
    return `${enumKey} = ${typeof v === 'string' ? `'${v}'` : v}`;
  }).join(',\n  ')}
}`;
    generatedEnums.push(enumDefinition);
  }
  
  // Build dependency graph for schemas
  const dependencyGraph = buildSchemaDependencyGraph(openApiDocument);
  const sortedSchemas = sortSchemasByDependency(dependencyGraph);
  
  // Process component schemas in dependency order
  if (openApiDocument.components?.schemas) {
    for (const schemaName of sortedSchemas) {
      const schema = openApiDocument.components.schemas[schemaName];
      if (!schema || processedSchemas.has(schemaName)) continue;
      
      const className = getClassNameFromSchemaName(schemaName, usedNames);
      const { properties, nestedClasses, enums } = generateClassProperties(
        schema,
        [],
        classMap,
        openApiDocument,
        usedNames,
        schemaName,
        usedEnums
      );
      
      // Skip empty classes
      if (properties.length === 0) {
        continue;
      }
      
      generatedEnums.push(...enums);
      
      // Handle multiple inheritance
      let extendsClause = '';
      if (schema.allOf) {
        const parents = getAllParentClasses(schema, openApiDocument);
        if (parents.length > 0) {
          // Use the first parent as the direct parent
          const primaryParent = parents[0];
          const primaryParentClassName = getClassNameFromSchemaName(primaryParent, usedNames);
          extendsClause = ` extends ${primaryParentClassName}`;
          
          // Create intermediate classes for additional parents if needed
          if (parents.length > 1) {
            const intermediateProps = new Set<string>();
            
            // Create intermediate classes for each additional parent
            for (let i = 1; i < parents.length; i++) {
              const parentName = parents[i];
              const parentSchema = openApiDocument.components.schemas[parentName];
              if (!parentSchema) continue;
              
              const parentClassName = getClassNameFromSchemaName(parentName, usedNames);
              const intermediateClassName = `${className}With${parentClassName}`;
              
              // Get properties from this parent
              const { properties: parentProps } = generateClassProperties(
                parentSchema,
                [],
                classMap,
                openApiDocument,
                usedNames,
                parentName,
                usedEnums
              );
              
              // Filter out properties already included
              const uniqueProps = parentProps.filter(prop => !intermediateProps.has(prop));
              uniqueProps.forEach(prop => intermediateProps.add(prop));
              
              if (uniqueProps.length > 0) {
                const intermediateClass = `
export class ${intermediateClassName} {
${uniqueProps.join('\n')}
}`;
                baseClasses.push(intermediateClass);
              }
            }
          }
        }
      }
      
      const classDefinition = `
export class ${className}${extendsClause} {
${properties.join('\n')}
}`;
      
      // Add nested classes to appropriate array
      nestedClasses.forEach(nestedClass => {
        if (nestedClass.includes(' extends ')) {
          childClasses.push(nestedClass);
        } else {
          baseClasses.push(nestedClass);
        }
      });
      
      // Add main class to appropriate array
      if (extendsClause) {
        childClasses.push(classDefinition);
      } else {
        baseClasses.push(classDefinition);
      }
      
      processedSchemas.add(schemaName);
    }
  }
  
  // Process each path and operation
  for (const [path, pathItem] of Object.entries(openApiDocument.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operation.operationId) continue;
      
      for (const [statusCode, operationResponse] of Object.entries(operation.responses)) {
        // Only process 2XX responses
        if (!statusCode.startsWith('2')) continue;
        const response = operationResponse as OpenAPIResponse;
        if (!response.content) continue;
        
        for (const [contentType, content] of Object.entries(response.content)) {
          if (!content.schema) continue;
          
          const className = getClassNameFromOperationId(operation.operationId, statusCode, usedNames);
          const { properties, nestedClasses, enums } = generateClassProperties(
            content.schema,
            [],
            classMap,
            openApiDocument,
            usedNames,
            operation.operationId,
            usedEnums
          );
          
          // Skip empty classes
          if (properties.length === 0) {
            continue;
          }
          
          generatedEnums.push(...enums);
          
          // Find parent class if this schema extends another
          let extendsClause = '';
          if (content.schema.allOf) {
            for (const subSchema of content.schema.allOf) {
              if (subSchema.$ref && subSchema.$ref.startsWith('#/components/schemas/')) {
                const parentName = subSchema.$ref.replace('#/components/schemas/', '');
                const parentClassName = getClassNameFromSchemaName(parentName, usedNames);
                extendsClause = ` extends ${parentClassName}`;
                break;
              }
            }
          } else if (content.schema.$ref && content.schema.$ref.startsWith('#/components/schemas/')) {
            const parentName = content.schema.$ref.replace('#/components/schemas/', '');
            const parentClassName = getClassNameFromSchemaName(parentName, usedNames);
            extendsClause = ` extends ${parentClassName}`;
          }
          
          const classDefinition = `
export class ${className}${extendsClause} {
${properties.join('\n')}
}`;
          
          // Add nested classes to appropriate array
          nestedClasses.forEach(nestedClass => {
            if (nestedClass.includes(' extends ')) {
              childClasses.push(nestedClass);
            } else {
              baseClasses.push(nestedClass);
            }
          });
          
          // Add main class to appropriate array
          if (extendsClause) {
            childClasses.push(classDefinition);
          } else {
            baseClasses.push(classDefinition); }
        }
      }
    }
  }
  
  // Add enums first, then base classes, then child classes
  output += [...new Set(generatedEnums)].join('\n\n');
  output += '\n\n';
  output += [...new Set(baseClasses)].join('\n');
  output += '\n\n';
  output += [...new Set(childClasses)].join('\n');
  
  // Ensure the directory exists before writing the file
  const outputDir = path.dirname(outputFilePath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Write the output to the specified file
  fs.writeFileSync(outputFilePath, output);
  console.log(`Generated classes written to ${outputFilePath}`);
}