#!/usr/bin/env bash
":" //# comment; exec /usr/bin/env node --input-type=module - "$@" < "$0"

import { readFile, writeFile } from 'fs/promises';
import openapi from 'openapi-typescript';
import { resolve } from 'path';
import { cwd } from 'process';

const NOTICE = `// This file was auto-generated by @insertish/oapi!\n`;

readFile('OpenAPI.json')
    .then(data => {
        const spec = JSON.parse(data);

        // Copy index.ts
        readFile(resolve(cwd(), 'node_modules', '@insertish', 'oapi', 'src', 'index.ts'))
            .then(data => writeFile('src/index.ts', data));

        // Generate Schema
        openapi(spec)
            .then(data => writeFile('src/schema.ts', data));

        // Route Types + Data
        {
            const entries = ["import { paths } from './schema';", "export type APIRoutes ="];
            const paths = Object.keys(spec.paths);
            const queryData = {};

            for (const path of paths) {
                const data = spec.paths[path];
                const methods = Object.keys(data);

                let template = path;
                if (process.argv.pop() !== 'strict') {
                    template = path.replace(/\{\w+\}/g, '${string}');
                }

                for (const method of methods) {
                    const OPERATION = `paths['${path}']['${method}']`;

                    const route = data[method];
                    const response = Object.keys(route['responses']).find(x => x !== 'default') ?? 'default';
                    const contentType = Object.keys(route['responses'][response]['content'] ?? {})[0];
                    const RESPONSE = response === '204' || !contentType ? 'undefined' : `${OPERATION}['responses']['${response}']['content']['${contentType}']`;

                    let queryParams = [];
                    let hasBody = false;

                    if (route['parameters']) {
                        for (const parameter of route['parameters']) {
                            if (parameter.in === 'query') {
                                queryParams.push(parameter.name);
                            }
                        }
                    }

                    if (route['requestBody']?.['content']?.['application/json']) {
                        hasBody = true;
                    }

                    let params = 'undefined';
                    if (hasBody || queryParams.length > 0) {
                        let entries = [];
                        
                        if (queryParams.length > 0) {
                            entries.push(`${OPERATION}['parameters']['query']`);
                        }

                        if (hasBody) {
                            entries.push(`${OPERATION}['requestBody']['content']['application/json']`);
                        }

                        params = entries.join('|');
                    }

                    const object = `{ method: '${method}', path: \`${template}\`, params: ${params}, response: ${RESPONSE} }`;
                    entries.push(`| ${object}`);

                    queryData[path] = {
                        ...queryData[path],
                        [method]: queryParams,
                    };
                }
            }

            const pathResolve = {};
            for (const path of paths) {
                const segments = path.split('/');
                segments.shift();
                pathResolve[segments.length] = [
                    ...(pathResolve[segments.length] ?? []),
                    segments.map(key => /\{.*\}/.test(key) ? [key] : key)
                ];
            }

            writeFile('src/routes.ts', NOTICE + entries.join('\n') + ";");
            writeFile('src/params.ts', NOTICE
                + "export const pathResolve = " + JSON.stringify(pathResolve) + ";\n"
                + "export const queryParams = " + JSON.stringify(queryData) + ";");
        }

        // Type Exports
        {
            const entries = ["import { components } from './schema';"];
            const schemas = spec.components.schemas;

            for (const schema of Object.keys(schemas)) {
                entries.push(`export type ${schema} = components['schemas']['${schema}'];`);
            }

            writeFile('src/types.ts', NOTICE + entries.join('\n') + ";");
        }

        // Default Base URL
        const baseURL = spec['servers']?.[0]?.['url'];
        writeFile('src/baseURL.ts', NOTICE + `export const defaultBaseURL = ${ baseURL ? '"' + baseURL + '"' : 'undefined' };`);
    });
