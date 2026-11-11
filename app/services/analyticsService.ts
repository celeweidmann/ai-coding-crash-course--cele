import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  courses,
  CourseStatus,
  enrollments,
  lessonProgress,
  LessonProgressStatus,
  lessons,
  modules,
} from "~/db/schema";

// ─── Analytics Service ───
// Aggregated instructor analytics: summary numbers across the instructor's
// published and archived courses. Drafts are excluded everywhere.
// Uses positional parameters (project convention).

const ANALYTICS_STATUSES = [CourseStatus.Published, CourseStatus.Archived];

export type AnalyticsSummary = {
  uniqueStudents: number;
  enrollments: number;
  completedEnrollments: number;
  /** Percentage 0–100, or null when there are no enrollments. */
  completionRate: number | null;
  /** Percentage 0–100, or null when there are no enrollments. */
  averageProgress: number | null;
};

// Correlated subqueries evaluated per enrollment row.
const courseLessonCount = sql`(
  select count(*) from ${lessons}
  join ${modules} on ${modules.id} = ${lessons.moduleId}
  where ${modules.courseId} = ${enrollments.courseId}
)`;

const completedLessonCount = sql`(
  select count(distinct ${lessonProgress.lessonId}) from ${lessonProgress}
  join ${lessons} on ${lessons.id} = ${lessonProgress.lessonId}
  join ${modules} on ${modules.id} = ${lessons.moduleId}
  where ${modules.courseId} = ${enrollments.courseId}
    and ${lessonProgress.userId} = ${enrollments.userId}
    and ${lessonProgress.status} = ${LessonProgressStatus.Completed}
)`;

/** Fraction 0–1 of the course's lessons completed by the enrolled student. */
const enrollmentProgress = sql`case when ${courseLessonCount} = 0 then 0.0
  else ${completedLessonCount} * 1.0 / ${courseLessonCount} end`;

/** Fraction 0–1 → rounded percentage 0–100; null stays null. */
function toPercent(fraction: number | null) {
  return fraction === null ? null : Math.round(fraction * 100);
}

export function getInstructorAnalytics(instructorId: number) {
  const courseIds = db
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(
        eq(courses.instructorId, instructorId),
        inArray(courses.status, ANALYTICS_STATUSES)
      )
    )
    .all()
    .map((c) => c.id);

  const counts = db
    .select({
      enrollments: sql<number>`count(*)`,
      uniqueStudents: sql<number>`count(distinct ${enrollments.userId})`,
      completed: sql<number>`count(${enrollments.completedAt})`,
      averageProgress: sql<number | null>`avg(${enrollmentProgress})`,
    })
    .from(enrollments)
    .where(inArray(enrollments.courseId, courseIds))
    .get()!;

  const summary: AnalyticsSummary = {
    uniqueStudents: counts.uniqueStudents,
    enrollments: counts.enrollments,
    completedEnrollments: counts.completed,
    completionRate: toPercent(
      counts.enrollments === 0 ? null : counts.completed / counts.enrollments
    ),
    averageProgress: toPercent(counts.averageProgress),
  };

  return { hasCourses: courseIds.length > 0, summary };
}
