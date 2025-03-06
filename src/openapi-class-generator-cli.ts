import { generateClassesFromOpenAPI } from './openapi-class-generator';
import * as fs from 'fs';
import * as path from 'path';

// Get command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: node openapi-class-generator-cli.js <openApiFilePath> <outputDirectory>');
  process.exit(1);
}

const openApiFilePath = args[0];
const outputDirectory = args[1];

// Ensure the output directory exists
if (!fs.existsSync(outputDirectory)) {
  fs.mkdirSync(outputDirectory, { recursive: true });
}

// Generate the classes
const classesOutputPath = path.join(outputDirectory, 'generated-classes.ts');
generateClassesFromOpenAPI(openApiFilePath, classesOutputPath);

console.log('Generation complete!');