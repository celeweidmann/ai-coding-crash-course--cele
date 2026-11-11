import { UserRole } from "~/db/schema";

export function getLoginDestination(
  role: UserRole,
  redirectTo: string | null
): string {
  if (redirectTo && redirectTo.startsWith("/")) return redirectTo;
  if (role === UserRole.Instructor) return "/instructor/analytics";
  return "/courses";
}
