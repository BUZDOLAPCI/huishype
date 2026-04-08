#!/usr/bin/env node

import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_TYPES[extension] || 'application/octet-stream';
}

function assertValidPort(port) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a valid TCP port, received "${port}"`);
  }
}

function listHtmlTemplates(rootDir, currentDir = rootDir) {
  const entries = readdirSync(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listHtmlTemplates(rootDir, absolutePath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(path.relative(rootDir, absolutePath));
    }
  }

  return files;
}

function toRouteSegments(templatePath) {
  const withoutExtension = templatePath.replace(/\.html$/, '');
  if (withoutExtension === 'index') {
    return [];
  }

  const normalized = withoutExtension.replace(/\/index$/, '');
  return normalized.split('/').filter(Boolean);
}

function matchTemplate(templateSegments, requestSegments) {
  let requestIndex = 0;
  let staticSegments = 0;
  let dynamicSegments = 0;

  for (let templateIndex = 0; templateIndex < templateSegments.length; templateIndex += 1) {
    const templateSegment = templateSegments[templateIndex];
    const isCatchAll =
      templateSegment.startsWith('[...') &&
      templateSegment.endsWith(']');
    const isDynamic =
      !isCatchAll &&
      templateSegment.startsWith('[') &&
      templateSegment.endsWith(']');

    if (isCatchAll) {
      if (requestIndex >= requestSegments.length) {
        return null;
      }

      dynamicSegments += requestSegments.length - requestIndex;
      requestIndex = requestSegments.length;
      continue;
    }

    const requestSegment = requestSegments[requestIndex];
    if (!requestSegment) {
      return null;
    }

    if (isDynamic) {
      dynamicSegments += 1;
      requestIndex += 1;
      continue;
    }

    if (templateSegment !== requestSegment) {
      return null;
    }

    staticSegments += 1;
    requestIndex += 1;
  }

  if (requestIndex !== requestSegments.length) {
    return null;
  }

  return { staticSegments, dynamicSegments };
}

export function startStaticWebServer({
  port,
  rootDir,
  host = '127.0.0.1',
  logger = console,
} = {}) {
  assertValidPort(port);

  if (!rootDir) {
    throw new Error('ROOT_DIR is required');
  }

  const resolvedRoot = path.resolve(rootDir);
  const fallbackDocument = path.join(resolvedRoot, 'index.html');
  const htmlTemplates = listHtmlTemplates(resolvedRoot)
    .map((templatePath) => ({
      templatePath,
      absolutePath: path.join(resolvedRoot, templatePath),
      routeSegments: toRouteSegments(templatePath),
    }))
    .sort((a, b) => a.templatePath.localeCompare(b.templatePath));

  if (!existsSync(fallbackDocument)) {
    throw new Error(`Missing SPA entrypoint at ${fallbackDocument}`);
  }

  const resolveRequestPath = (requestUrl) => {
    const parsed = new URL(requestUrl, `http://${host}`);
    const pathname = decodeURIComponent(parsed.pathname);
    const relativePath = pathname === '/' ? '/index.html' : pathname;
    const candidatePath = path.resolve(resolvedRoot, `.${relativePath}`);

    if (!candidatePath.startsWith(resolvedRoot)) {
      return fallbackDocument;
    }

    if (existsSync(candidatePath) && statSync(candidatePath).isFile()) {
      return candidatePath;
    }

    const htmlCandidatePath = path.resolve(resolvedRoot, `.${pathname}.html`);
    if (
      htmlCandidatePath.startsWith(resolvedRoot) &&
      existsSync(htmlCandidatePath) &&
      statSync(htmlCandidatePath).isFile()
    ) {
      return htmlCandidatePath;
    }

    const requestSegments = pathname.split('/').filter(Boolean);
    const templateMatch = htmlTemplates
      .map((template) => {
        const match = matchTemplate(template.routeSegments, requestSegments);
        return match ? { ...template, ...match } : null;
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.staticSegments !== b.staticSegments) {
          return b.staticSegments - a.staticSegments;
        }

        if (a.dynamicSegments !== b.dynamicSegments) {
          return a.dynamicSegments - b.dynamicSegments;
        }

        return a.templatePath.localeCompare(b.templatePath);
      })[0];

    if (templateMatch) {
      return templateMatch.absolutePath;
    }

    return fallbackDocument;
  };

  const server = createServer((request, response) => {
    const filePath = resolveRequestPath(request.url || '/');
    const contentType = getContentType(filePath);

    response.statusCode = 200;
    response.setHeader('Content-Type', contentType);
    response.setHeader('Cache-Control', 'no-store');

    const stream = createReadStream(filePath);
    stream.on('error', (error) => {
      logger.error(`Static file read failed for ${filePath}:`, error);
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      }
      response.end('Internal Server Error');
    });
    stream.pipe(response);
  });

  const ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      logger.log(`Static web server listening on http://${host}:${port} serving ${resolvedRoot}`);
      resolve();
    });
  });

  const closed = new Promise((resolve) => {
    server.once('close', () => resolve());
  });

  return {
    server,
    ready,
    closed,
    async stop() {
      if (!server.listening) {
        return;
      }

      await new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

const isEntrypoint = process.argv[1] != null
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isEntrypoint) {
  const port = Number.parseInt(process.env.PORT || '8082', 10);
  const rootDir = process.env.ROOT_DIR;
  const runtime = startStaticWebServer({ port, rootDir });

  const shutdown = (signal) => {
    runtime.stop()
      .then(() => {
        process.exit(signal === 'SIGTERM' || signal === 'SIGINT' ? 0 : 1);
      })
      .catch((error) => {
        console.error(error);
        process.exit(1);
      });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('uncaughtException', (error) => {
    console.error(error);
    shutdown('uncaughtException');
  });
  process.once('unhandledRejection', (error) => {
    console.error(error);
    shutdown('unhandledRejection');
  });
}
