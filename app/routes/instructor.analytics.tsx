import { Link } from "react-router";
import type { Route } from "./+types/instructor.analytics";
import { getInstructorAnalytics } from "~/services/analyticsService";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { AlertTriangle, BarChart3, Plus } from "lucide-react";
import { data, isRouteErrorResponse } from "react-router";
import { UserRole } from "~/db/schema";

export function meta() {
  return [
    { title: "Analytics — Cadence" },
    { name: "description", content: "How students are doing in your courses" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view your analytics.", {
      status: 401,
    });
  }

  const user = getUserById(currentUserId);

  if (!user || user.role !== UserRole.Instructor) {
    throw data("Only instructors can access this page.", { status: 403 });
  }

  return getInstructorAnalytics(currentUserId);
}

function formatPercent(value: number | null) {
  return value === null ? "—" : `${value}%`;
}

const headerClass =
  "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground";
const numericHeaderClass =
  "px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground";
const numericCellClass = "px-4 py-3 text-right text-sm tabular-nums";

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Skeleton className="mb-8 h-9 w-40" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="mt-10 h-48" />
    </div>
  );
}

export default function InstructorAnalytics({
  loaderData,
}: Route.ComponentProps) {
  const { hasCourses, summary, courses } = loaderData;

  const stats = [
    { label: "Students", value: String(summary.uniqueStudents) },
    { label: "Enrollments", value: String(summary.enrollments) },
    { label: "Completed", value: String(summary.completedEnrollments) },
    { label: "Completion rate", value: formatPercent(summary.completionRate) },
    { label: "Average progress", value: formatPercent(summary.averageProgress) },
  ];

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Analytics</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Analytics</h1>
        <p className="mt-1 text-muted-foreground">
          How students are doing across your courses
        </p>
      </div>

      {!hasCourses ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BarChart3 className="mb-4 size-12 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">No courses yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Analytics appear once you have a published or archived course.
          </p>
          <Link to="/instructor/new" className="mt-4">
            <Button>
              <Plus className="mr-2 size-4" />
              Create Course
            </Button>
          </Link>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {stats.map((stat) => (
              <Card key={stat.label}>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="mt-1 text-3xl font-bold tabular-nums">
                    {stat.value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <h2 className="mb-4 mt-10 text-xl font-semibold">Courses</h2>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className={headerClass}>Course</th>
                      <th className={numericHeaderClass}>Enrolled</th>
                      <th className={numericHeaderClass}>Completed</th>
                      <th className={numericHeaderClass}>Completion rate</th>
                      <th className={numericHeaderClass}>Average progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courses.map((course) => (
                      <tr
                        key={course.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 py-3 text-sm font-medium">
                          {course.title}
                        </td>
                        <td className={numericCellClass}>{course.enrolled}</td>
                        <td className={numericCellClass}>{course.completed}</td>
                        <td className={numericCellClass}>
                          {formatPercent(course.completionRate)}
                        </td>
                        <td className={numericCellClass}>
                          {formatPercent(course.averageProgress)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have permission to access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button variant="outline">Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
