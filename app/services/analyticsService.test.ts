import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import {
  CourseNotFoundError,
  getInstructorAnalytics,
} from "./analyticsService";

function createInstructor(email: string) {
  return testDb
    .insert(schema.users)
    .values({ name: email, email, role: schema.UserRole.Instructor })
    .returning()
    .get();
}

function createStudent(email: string) {
  return testDb
    .insert(schema.users)
    .values({ name: email, email, role: schema.UserRole.Student })
    .returning()
    .get();
}

function createCourse(
  instructorId: number,
  slug: string,
  status: schema.CourseStatus = schema.CourseStatus.Published
) {
  return testDb
    .insert(schema.courses)
    .values({
      title: slug,
      slug,
      description: slug,
      salesCopy: slug,
      instructorId,
      categoryId: base.category.id,
      status,
    })
    .returning()
    .get();
}

function createLessons(courseId: number, count: number) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();
  return Array.from({ length: count }, (_, i) =>
    testDb
      .insert(schema.lessons)
      .values({ moduleId: mod.id, title: `Lesson ${i + 1}`, position: i + 1 })
      .returning()
      .get()
  );
}

function enroll(userId: number, courseId: number, completed = false) {
  return testDb
    .insert(schema.enrollments)
    .values({
      userId,
      courseId,
      completedAt: completed ? new Date().toISOString() : null,
    })
    .returning()
    .get();
}

function completeLesson(userId: number, lessonId: number) {
  testDb
    .insert(schema.lessonProgress)
    .values({
      userId,
      lessonId,
      status: schema.LessonProgressStatus.Completed,
      completedAt: new Date().toISOString(),
    })
    .run();
}

describe("getInstructorAnalytics", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("summary", () => {
    it("returns an empty summary for an instructor with no courses", () => {
      const lonely = createInstructor("lonely@example.com");

      const result = getInstructorAnalytics(lonely.id);

      expect(result.hasCourses).toBe(false);
      expect(result.summary).toEqual({
        uniqueStudents: 0,
        enrollments: 0,
        completedEnrollments: 0,
        completionRate: null,
        averageProgress: null,
      });
    });

    it("returns null rates for a course with no enrollments", () => {
      const result = getInstructorAnalytics(base.instructor.id);

      expect(result.hasCourses).toBe(true);
      expect(result.summary).toEqual({
        uniqueStudents: 0,
        enrollments: 0,
        completedEnrollments: 0,
        completionRate: null,
        averageProgress: null,
      });
    });

    it("counts enrollments, completed enrollments and the completion rate", () => {
      const s2 = createStudent("s2@example.com");
      const s3 = createStudent("s3@example.com");
      const s4 = createStudent("s4@example.com");
      enroll(base.user.id, base.course.id, true);
      enroll(s2.id, base.course.id);
      enroll(s3.id, base.course.id);
      enroll(s4.id, base.course.id);

      const { hasCourses, summary } = getInstructorAnalytics(base.instructor.id);

      expect(hasCourses).toBe(true);
      expect(summary.enrollments).toBe(4);
      expect(summary.completedEnrollments).toBe(1);
      expect(summary.completionRate).toBe(25);
    });

    it("counts a student enrolled in two of the instructor's courses once", () => {
      const second = createCourse(base.instructor.id, "second-course");
      const s2 = createStudent("s2@example.com");
      enroll(base.user.id, base.course.id);
      enroll(base.user.id, second.id);
      enroll(s2.id, second.id);

      const { summary } = getInstructorAnalytics(base.instructor.id);

      expect(summary.uniqueStudents).toBe(2);
      expect(summary.enrollments).toBe(3);
    });

    it("averages progress per enrollment across courses", () => {
      // Course A: 4 lessons. Student 1 completed 2 (50%), student 2 completed 4 (100%).
      // Course B: 2 lessons. Student 1 completed 0 (0%).
      // Average of 50, 100, 0 = 50.
      const lessonsA = createLessons(base.course.id, 4);
      const courseB = createCourse(base.instructor.id, "course-b");
      createLessons(courseB.id, 2);
      const s2 = createStudent("s2@example.com");
      enroll(base.user.id, base.course.id);
      enroll(s2.id, base.course.id);
      enroll(base.user.id, courseB.id);
      completeLesson(base.user.id, lessonsA[0].id);
      completeLesson(base.user.id, lessonsA[1].id);
      lessonsA.forEach((l) => completeLesson(s2.id, l.id));

      const { summary } = getInstructorAnalytics(base.instructor.id);

      expect(summary.averageProgress).toBe(50);
    });

    it("ignores lessons that are only in progress", () => {
      const [lesson1, lesson2] = createLessons(base.course.id, 2);
      enroll(base.user.id, base.course.id);
      completeLesson(base.user.id, lesson1.id);
      testDb
        .insert(schema.lessonProgress)
        .values({
          userId: base.user.id,
          lessonId: lesson2.id,
          status: schema.LessonProgressStatus.InProgress,
        })
        .run();

      const { summary } = getInstructorAnalytics(base.instructor.id);

      expect(summary.averageProgress).toBe(50);
    });
  });

  describe("courses", () => {
    it("returns one row per course with its enrollment numbers", () => {
      const lessons = createLessons(base.course.id, 2);
      const s2 = createStudent("s2@example.com");
      enroll(base.user.id, base.course.id, true);
      enroll(s2.id, base.course.id);
      lessons.forEach((l) => completeLesson(base.user.id, l.id));

      const { courses } = getInstructorAnalytics(base.instructor.id);

      expect(courses).toEqual([
        {
          id: base.course.id,
          title: base.course.title,
          enrolled: 2,
          completed: 1,
          completionRate: 50,
          averageProgress: 50,
        },
      ]);
    });

    it("returns null rates for a course with no enrollments", () => {
      createLessons(base.course.id, 3);

      const { courses } = getInstructorAnalytics(base.instructor.id);

      expect(courses).toEqual([
        {
          id: base.course.id,
          title: base.course.title,
          enrolled: 0,
          completed: 0,
          completionRate: null,
          averageProgress: null,
        },
      ]);
    });

    it("keeps each course's numbers separate", () => {
      // Course A: 2 lessons, two students — one finished (100%), one at 50%.
      // Course B: 4 lessons, one student at 25%, not finished.
      const lessonsA = createLessons(base.course.id, 2);
      const courseB = createCourse(base.instructor.id, "course-b");
      const lessonsB = createLessons(courseB.id, 4);
      const s2 = createStudent("s2@example.com");
      enroll(base.user.id, base.course.id, true);
      enroll(s2.id, base.course.id);
      enroll(base.user.id, courseB.id);
      lessonsA.forEach((l) => completeLesson(base.user.id, l.id));
      completeLesson(s2.id, lessonsA[0].id);
      completeLesson(base.user.id, lessonsB[0].id);

      const { courses } = getInstructorAnalytics(base.instructor.id);
      const byId = new Map(courses.map((c) => [c.id, c]));

      expect(byId.get(base.course.id)).toMatchObject({
        enrolled: 2,
        completed: 1,
        completionRate: 50,
        averageProgress: 75,
      });
      expect(byId.get(courseB.id)).toMatchObject({
        enrolled: 1,
        completed: 0,
        completionRate: 0,
        averageProgress: 25,
      });
    });

    it("adds up to the summary", () => {
      // Course A: 2 lessons, progress 100% and 0%  → average 50.
      // Course B: 1 lesson, progress 100%          → average 100.
      // Course C: no enrollments, must not drag the summary average down.
      // Summary average over all 3 enrollments = (100 + 0 + 100) / 3 ≈ 67.
      const lessonsA = createLessons(base.course.id, 2);
      const courseB = createCourse(base.instructor.id, "course-b");
      const [lessonB] = createLessons(courseB.id, 1);
      createCourse(base.instructor.id, "course-c");
      const s2 = createStudent("s2@example.com");
      enroll(base.user.id, base.course.id, true);
      enroll(s2.id, base.course.id);
      enroll(base.user.id, courseB.id, true);
      lessonsA.forEach((l) => completeLesson(base.user.id, l.id));
      completeLesson(base.user.id, lessonB.id);

      const { summary, courses } = getInstructorAnalytics(base.instructor.id);

      expect(courses).toHaveLength(3);
      expect(courses.reduce((n, c) => n + c.enrolled, 0)).toBe(3);
      expect(courses.reduce((n, c) => n + c.completed, 0)).toBe(2);
      expect(summary.enrollments).toBe(3);
      expect(summary.completedEnrollments).toBe(2);
      expect(courses.map((c) => c.averageProgress).sort()).toEqual([
        100,
        50,
        null,
      ].sort());
      expect(summary.averageProgress).toBe(67);
    });
  });

  describe("course scope", () => {
    it("excludes draft courses and includes archived ones", () => {
      const draft = createCourse(
        base.instructor.id,
        "draft-course",
        schema.CourseStatus.Draft
      );
      const archived = createCourse(
        base.instructor.id,
        "archived-course",
        schema.CourseStatus.Archived
      );
      const s2 = createStudent("s2@example.com");
      enroll(base.user.id, draft.id, true);
      enroll(s2.id, archived.id, true);

      const { summary, courses } = getInstructorAnalytics(base.instructor.id);

      expect(summary.enrollments).toBe(1);
      expect(summary.completedEnrollments).toBe(1);
      expect(summary.uniqueStudents).toBe(1);
      expect(courses.map((c) => c.id).sort()).toEqual(
        [base.course.id, archived.id].sort()
      );
    });

    it("treats an instructor with only draft courses as having no courses", () => {
      const drafter = createInstructor("drafter@example.com");
      createCourse(drafter.id, "only-draft", schema.CourseStatus.Draft);

      expect(getInstructorAnalytics(drafter.id).hasCourses).toBe(false);
    });

    it("never counts another instructor's courses", () => {
      const other = createInstructor("other@example.com");
      const otherCourse = createCourse(other.id, "other-course");
      enroll(base.user.id, otherCourse.id, true);

      const mine = getInstructorAnalytics(base.instructor.id);
      const theirs = getInstructorAnalytics(other.id);

      expect(mine.summary.enrollments).toBe(0);
      expect(mine.summary.completionRate).toBeNull();
      expect(theirs.summary.enrollments).toBe(1);
      expect(theirs.summary.completionRate).toBe(100);
      expect(mine.courses.map((c) => c.id)).toEqual([base.course.id]);
      expect(theirs.courses.map((c) => c.id)).toEqual([otherCourse.id]);
    });
  });
  describe("funnel", () => {
    function createModule(courseId: number, position: number) {
      return testDb
        .insert(schema.modules)
        .values({ courseId, title: `Module ${position}`, position })
        .returning()
        .get();
    }

    function createLesson(moduleId: number, title: string, position: number) {
      return testDb
        .insert(schema.lessons)
        .values({ moduleId, title, position })
        .returning()
        .get();
    }

    it("orders lessons by module position, then lesson position", () => {
      // Inserted out of order on purpose.
      const mod2 = createModule(base.course.id, 2);
      const mod1 = createModule(base.course.id, 1);
      createLesson(mod2.id, "2.2", 2);
      createLesson(mod1.id, "1.2", 2);
      createLesson(mod2.id, "2.1", 1);
      createLesson(mod1.id, "1.1", 1);

      const { funnel } = getInstructorAnalytics(
        base.instructor.id,
        base.course.id
      );

      expect(funnel!.lessons.map((l) => l.title)).toEqual([
        "1.1",
        "1.2",
        "2.1",
        "2.2",
      ]);
    });
    it("counts completed lessons as a percentage of enrolled students", () => {
      // 4 enrolled. Lesson 1: 3 completed (75%). Lesson 2: 1 completed (25%).
      // Lesson 3: nobody (0%).
      const [l1, l2, l3] = createLessons(base.course.id, 3);
      const students = [
        base.user,
        createStudent("s2@example.com"),
        createStudent("s3@example.com"),
        createStudent("s4@example.com"),
      ];
      students.forEach((s) => enroll(s.id, base.course.id));
      students.slice(0, 3).forEach((s) => completeLesson(s.id, l1.id));
      completeLesson(students[0].id, l2.id);

      const { funnel } = getInstructorAnalytics(
        base.instructor.id,
        base.course.id
      );

      expect(funnel).toEqual({
        courseId: base.course.id,
        title: base.course.title,
        enrolled: 4,
        lessons: [
          { id: l1.id, title: "Lesson 1", completed: 3, percentage: 75 },
          { id: l2.id, title: "Lesson 2", completed: 1, percentage: 25 },
          { id: l3.id, title: "Lesson 3", completed: 0, percentage: 0 },
        ],
      });
    });

    it("ignores lessons that are only in progress", () => {
      const [lesson] = createLessons(base.course.id, 1);
      const s2 = createStudent("s2@example.com");
      enroll(base.user.id, base.course.id);
      enroll(s2.id, base.course.id);
      completeLesson(base.user.id, lesson.id);
      testDb
        .insert(schema.lessonProgress)
        .values({
          userId: s2.id,
          lessonId: lesson.id,
          status: schema.LessonProgressStatus.InProgress,
        })
        .run();

      const { funnel } = getInstructorAnalytics(
        base.instructor.id,
        base.course.id
      );

      expect(funnel!.lessons[0]).toMatchObject({ completed: 1, percentage: 50 });
    });

    it("ignores progress from students not enrolled in the course", () => {
      const [lesson] = createLessons(base.course.id, 1);
      const outsider = createStudent("outsider@example.com");
      enroll(base.user.id, base.course.id);
      completeLesson(outsider.id, lesson.id);

      const { funnel } = getInstructorAnalytics(
        base.instructor.id,
        base.course.id
      );

      expect(funnel!.lessons[0]).toMatchObject({ completed: 0, percentage: 0 });
    });
    it("defaults to the course with the most enrollments", () => {
      const popular = createCourse(base.instructor.id, "popular");
      const s2 = createStudent("s2@example.com");
      enroll(base.user.id, base.course.id);
      enroll(base.user.id, popular.id);
      enroll(s2.id, popular.id);

      const { funnel } = getInstructorAnalytics(base.instructor.id);

      expect(funnel).toMatchObject({ courseId: popular.id, enrolled: 2 });
    });

    it("is null when the instructor has no eligible courses", () => {
      const drafter = createInstructor("drafter@example.com");
      createCourse(drafter.id, "only-draft", schema.CourseStatus.Draft);

      expect(getInstructorAnalytics(drafter.id).funnel).toBeNull();
    });

    it("has null percentages for a course with no enrollments", () => {
      const [lesson] = createLessons(base.course.id, 1);

      const { funnel } = getInstructorAnalytics(
        base.instructor.id,
        base.course.id
      );

      expect(funnel).toMatchObject({
        enrolled: 0,
        lessons: [{ id: lesson.id, completed: 0, percentage: null }],
      });
    });
    it("signals not found for a course that does not exist", () => {
      expect(() =>
        getInstructorAnalytics(base.instructor.id, 999_999)
      ).toThrow(CourseNotFoundError);
    });

    it("signals not found for a draft course", () => {
      const draft = createCourse(
        base.instructor.id,
        "draft-course",
        schema.CourseStatus.Draft
      );

      expect(() => getInstructorAnalytics(base.instructor.id, draft.id)).toThrow(
        CourseNotFoundError
      );
    });

    it("signals not found for another instructor's course", () => {
      const other = createInstructor("other@example.com");
      const otherCourse = createCourse(other.id, "other-course");

      expect(() =>
        getInstructorAnalytics(base.instructor.id, otherCourse.id)
      ).toThrow(CourseNotFoundError);
    });
  });
});
