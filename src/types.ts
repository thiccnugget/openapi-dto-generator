export interface OpenAPISchema {
  type?: string;
  format?: string;
  nullable?: boolean;
  enum?: any[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  properties?: Record<string, OpenAPISchema>;
  items?: OpenAPISchema;
  required?: string[];
  oneOf?: OpenAPISchema[];
  allOf?: OpenAPISchema[];
  anyOf?: OpenAPISchema[];
  $ref?: string;
  description?: string;
  title?: string;
}

export interface OpenAPIResponse {
  description?: string;
  content?: Record<string, {
    schema: OpenAPISchema;
  }>;
}

export interface OpenAPIOperation {
  operationId: string;
  responses: Record<string, OpenAPIResponse>;
  summary?: string;
  description?: string;
}

export interface OpenAPIPath {
  get?: OpenAPIOperation;
  post?: OpenAPIOperation;
  put?: OpenAPIOperation;
  delete?: OpenAPIOperation;
  patch?: OpenAPIOperation;
}

export interface OpenAPIDocument {
  paths: Record<string, OpenAPIPath>;
  components?: {
    schemas?: Record<string, OpenAPISchema>;
  };
}