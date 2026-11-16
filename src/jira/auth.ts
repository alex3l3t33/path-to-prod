export function buildJiraAuthorization(email: string, token: string): string {
  const normalizedEmail = email.trim();
  const normalizedToken = token.trim();
  if (normalizedEmail) return `Basic ${btoa(`${normalizedEmail}:${normalizedToken}`)}`;
  return `Bearer ${normalizedToken}`;
}
