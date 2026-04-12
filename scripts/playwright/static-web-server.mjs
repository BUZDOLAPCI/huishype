#!/usr/bin/env node

import {
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
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

function isExistingFile(filePath) {
  return existsSync(filePath) && statSync(filePath).isFile();
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

function isAssetLikePath(pathname) {
  const extension = path.extname(pathname);
  return extension.length > 0;
}

function isHtmlDocument(filePath) {
  return path.extname(filePath).toLowerCase() === '.html';
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

const REPRESENTATION_HEADERS = new Set([
  'content-encoding',
  'content-length',
]);

function toRouteSegments(templatePath) {
  const withoutExtension = templatePath.replace(/\.html$/, '');
  if (withoutExtension === 'index') {
    return [];
  }

  const normalized = withoutExtension.replace(/\/index$/, '');
  return normalized.split('/').filter(Boolean);
}

function parseTemplateSegment(templateSegment) {
  const catchAllMatch = templateSegment.match(/^\[\.\.\.([^\]]+)\]$/);
  if (catchAllMatch) {
    return { type: 'catchall', prefix: '', suffix: '', paramName: catchAllMatch[1] };
  }

  const dynamicMatch = templateSegment.match(/^([^[]*)\[([^\]]+)\]([^[]*)$/);
  if (dynamicMatch) {
    const [, prefix, paramName, suffix] = dynamicMatch;
    if (paramName.startsWith('...')) {
      return {
        type: 'catchall',
        prefix,
        suffix,
        paramName: paramName.slice(3),
      };
    }

    return {
      type: 'dynamic',
      prefix,
      suffix,
      paramName,
    };
  }

  return { type: 'static', prefix: '', suffix: '', paramName: null };
}

function matchTemplate(templateSegments, requestSegments) {
  let requestIndex = 0;
  let staticSegments = 0;
  let dynamicSegments = 0;
  let usesCatchall = false;

  for (let templateIndex = 0; templateIndex < templateSegments.length; templateIndex += 1) {
    const templateSegment = templateSegments[templateIndex];
    const parsedSegment = parseTemplateSegment(templateSegment);

    if (parsedSegment.type === 'catchall') {
      if (requestIndex >= requestSegments.length) {
        return null;
      }

      const requestSegment = requestSegments[requestIndex];
      if (
        !requestSegment.startsWith(parsedSegment.prefix) ||
        !requestSegment.endsWith(parsedSegment.suffix)
      ) {
        return null;
      }

      dynamicSegments += requestSegments.length - requestIndex;
      usesCatchall = true;
      requestIndex = requestSegments.length;
      continue;
    }

    const requestSegment = requestSegments[requestIndex];
    if (!requestSegment) {
      return null;
    }

    if (parsedSegment.type === 'dynamic') {
      if (!requestSegment.startsWith(parsedSegment.prefix) ||
          !requestSegment.endsWith(parsedSegment.suffix)) {
        return null;
      }

      dynamicSegments += 1;
      if (parsedSegment.prefix.length > 0 || parsedSegment.suffix.length > 0) {
        staticSegments += 1;
      }
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

  return { staticSegments, dynamicSegments, usesCatchall };
}

function uniquePaths(paths) {
  return [...new Set(paths)];
}

function getHtmlRouteCandidates(rootDir, pathname) {
  const normalizedPath = pathname.replace(/^\/+/, '');
  if (!normalizedPath) {
    return [path.join(rootDir, 'index.html')];
  }

  return uniquePaths([
    path.join(rootDir, `${normalizedPath}.html`),
    path.join(rootDir, normalizedPath, 'index.html'),
  ]);
}

function resolveFirstExistingFile(candidates) {
  for (const candidate of candidates) {
    if (isExistingFile(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getTemplateFileCandidates(rootDir, templatePath) {
  const withoutExtension = templatePath.replace(/\.html$/, '');
  const candidates = [path.join(rootDir, templatePath)];

  if (withoutExtension && withoutExtension !== 'index') {
    candidates.push(path.join(rootDir, withoutExtension, 'index.html'));
  }

  if (templatePath.endsWith('/index.html')) {
    candidates.push(path.join(rootDir, `${withoutExtension}.html`));
  }

  return uniquePaths(candidates);
}

export function startStaticWebServer({
  port,
  rootDir,
  host = '127.0.0.1',
  logger = console,
  apiProxyTarget = null,
} = {}) {
  assertValidPort(port);

  if (!rootDir) {
    throw new Error('ROOT_DIR is required');
  }

  const resolvedRoot = path.resolve(rootDir);
  const fallbackDocument = path.join(resolvedRoot, 'index.html');
  const fallbackHtml = readFileSync(fallbackDocument);
  const htmlTemplates = listHtmlTemplates(resolvedRoot)
    .map((templatePath) => ({
      templatePath,
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
      return { statusCode: 404, filePath: null };
    }

    if (isExistingFile(candidatePath)) {
      return { statusCode: 200, filePath: candidatePath };
    }

    const htmlCandidatePath = resolveFirstExistingFile(getHtmlRouteCandidates(resolvedRoot, pathname));
    if (htmlCandidatePath) {
      return { statusCode: 200, filePath: htmlCandidatePath };
    }

    const requestSegments = pathname.split('/').filter(Boolean);
    const templateMatches = htmlTemplates
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
      });

    const specificTemplateMatch = templateMatches.find((template) => !template.usesCatchall);
    if (specificTemplateMatch) {
      const templateFilePath = resolveFirstExistingFile(
        getTemplateFileCandidates(resolvedRoot, specificTemplateMatch.templatePath),
      );
      if (templateFilePath) {
        return { statusCode: 200, filePath: templateFilePath };
      }
    }

    if (isAssetLikePath(pathname)) {
      return { statusCode: 404, filePath: null };
    }

    const catchallTemplateMatch = templateMatches.find((template) => template.usesCatchall);
    if (catchallTemplateMatch) {
      const templateFilePath = resolveFirstExistingFile(
        getTemplateFileCandidates(resolvedRoot, catchallTemplateMatch.templatePath),
      );
      if (templateFilePath) {
        return { statusCode: 200, filePath: templateFilePath };
      }
    }

    return { statusCode: 200, filePath: fallbackDocument };
  };

  const proxyApiRequest = async (request, response) => {
    if (!apiProxyTarget) {
      response.statusCode = 404;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end('Not Found');
      return;
    }

    const requestUrl = new URL(request.url || '/', `http://${host}`);
    const upstreamUrl = new URL(apiProxyTarget);
    upstreamUrl.pathname = requestUrl.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
    upstreamUrl.search = requestUrl.search;

    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (!value || key === 'host') {
        continue;
      }

      if (Array.isArray(value)) {
        value.forEach((item) => headers.append(key, item));
        continue;
      }

      headers.set(key, value);
    }
    headers.set('accept-encoding', 'identity');

    const method = request.method || 'GET';
    let body;
    if (method !== 'GET' && method !== 'HEAD') {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      body = Buffer.concat(chunks);
    }

    const upstreamResponse = await fetch(upstreamUrl, {
      method,
      headers,
      body,
      redirect: 'manual',
    });

    response.statusCode = upstreamResponse.status;
    response.statusMessage = upstreamResponse.statusText;

    upstreamResponse.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (
        !HOP_BY_HOP_HEADERS.has(lowerKey) &&
        !REPRESENTATION_HEADERS.has(lowerKey)
      ) {
        response.setHeader(key, value);
      }
    });

    response.setHeader('Cache-Control', 'no-store');
    response.removeHeader('content-encoding');
    response.removeHeader('content-length');

    if (!upstreamResponse.body) {
      response.end();
      return;
    }

    const proxyStream = Readable.fromWeb(upstreamResponse.body);
    proxyStream.on('error', (error) => {
      response.destroy(error);
    });
    proxyStream.pipe(response);
  };

  const streamHtmlFile = (filePath, response) => {
    const stream = createReadStream(filePath);

    stream.on('error', (error) => {
      logger.error(`Static file read failed for ${filePath}:`, error);

      if (!isHtmlDocument(filePath) || response.headersSent) {
        if (!response.headersSent) {
          response.statusCode = 500;
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        }
        response.end('Internal Server Error');
        return;
      }

      response.end(fallbackHtml);
    });

    stream.pipe(response);
  };

  const server = createServer(async (request, response) => {
    const requestUrl = request.url || '/';
    const parsedUrl = new URL(requestUrl, `http://${host}`);
    if (parsedUrl.pathname === '/api' || parsedUrl.pathname.startsWith('/api/')) {
      try {
        await proxyApiRequest(request, response);
      } catch (error) {
        logger.error?.(error);
        response.statusCode = 502;
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end('Bad Gateway');
      }
      return;
    }

    const { statusCode, filePath } = resolveRequestPath(request.url || '/');

    if (statusCode === 404 || !filePath) {
      response.statusCode = 404;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end('Not Found');
      return;
    }

    const contentType = getContentType(filePath);

    response.statusCode = statusCode;
    response.setHeader('Content-Type', contentType);
    response.setHeader('Cache-Control', 'no-store');

    streamHtmlFile(filePath, response);
  });

  const ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      logger.log(`Static web server listening on http://${host}:${port} serving ${resolvedRoot}`);
      resolve();
    });
  });

  return {
    server,
    ready,
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
