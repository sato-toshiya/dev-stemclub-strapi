export const getErrorMessage = (err: unknown, fallback = 'Unexpected error'): string => {
  if (!err) return fallback;
  if (err instanceof Error) return err.message || fallback;
  return String((err as any)?.message ?? err) || fallback;
};
