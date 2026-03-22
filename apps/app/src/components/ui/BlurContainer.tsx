/**
 * BlurContainer — Platform-resolved re-export.
 *
 * Metro resolves .native.tsx / .web.tsx automatically, but this base
 * file serves as the fallback for environments that do not perform
 * platform resolution (e.g. Jest with jsdom). It re-exports the web
 * implementation which works in a DOM environment.
 */
export { BlurContainer, type BlurContainerProps } from './BlurContainer.web';
