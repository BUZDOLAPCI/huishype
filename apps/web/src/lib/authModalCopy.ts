export interface AuthModalCopy {
  title?: string;
  subtitle?: string;
}

export type AuthModalCopyInput = string | AuthModalCopy;

export interface ResolvedAuthModalCopy {
  title: string;
  subtitle: string;
}

export const DEFAULT_AUTH_MODAL_COPY: ResolvedAuthModalCopy = {
  title: 'Welcome to HuisHype',
  subtitle: 'Sign in to continue',
};

export function resolveAuthModalCopy(
  input?: AuthModalCopyInput,
  fallback: ResolvedAuthModalCopy = DEFAULT_AUTH_MODAL_COPY,
): ResolvedAuthModalCopy {
  if (typeof input === 'string') {
    return {
      title: fallback.title,
      subtitle: input,
    };
  }

  return {
    title: fallback.title,
    subtitle: input?.subtitle ?? input?.title ?? fallback.subtitle,
  };
}
