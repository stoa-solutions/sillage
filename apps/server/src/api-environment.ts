/** Request variables set by authentication before any feature route runs. */
export type ApiEnvironment = {
  Variables: { installationId: string; userId: string };
};
