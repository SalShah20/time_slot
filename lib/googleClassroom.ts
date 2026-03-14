export interface ClassroomAssignment {
  id: string;
  title: string;
  dueDate: string | null; // ISO 8601 UTC
  courseId: string;
  courseName?: string;
  maxPoints: number | null;
}

interface ClassroomCourse {
  id: string;
  name: string;
  courseState: string;
}

interface ClassroomCourseWork {
  id: string;
  title: string;
  dueDate?: { year: number; month: number; day: number };
  dueTime?: { hours: number; minutes: number };
  state: string;
  maxPoints?: number;
}

/**
 * Fetches upcoming (next 14 days) assignments from Google Classroom.
 * Uses the user's Google access token (same token as Calendar).
 */
export async function fetchUpcomingClassroomAssignments(
  accessToken: string,
): Promise<ClassroomAssignment[]> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  const coursesRes = await fetch(
    'https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=30',
    { headers },
  );
  if (!coursesRes.ok) {
    throw new Error(`Classroom API error: ${coursesRes.status}`);
  }
  const coursesData = (await coursesRes.json()) as { courses?: ClassroomCourse[] };
  const courses = coursesData.courses ?? [];

  const now = new Date();
  const twoWeeksOut = new Date(now.getTime() + 14 * 24 * 60 * 60_000);

  const workArrays = await Promise.all(
    courses.map(async (course) => {
      try {
        const res = await fetch(
          `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork?orderBy=dueDate%20asc&pageSize=20`,
          { headers },
        );
        if (!res.ok) return [];
        const data = (await res.json()) as { courseWork?: ClassroomCourseWork[] };
        const items: ClassroomAssignment[] = (data.courseWork ?? [])
          .filter((cw) => {
            if (!cw.dueDate || cw.state !== 'PUBLISHED') return false;
            const due = new Date(
              cw.dueDate.year,
              cw.dueDate.month - 1,
              cw.dueDate.day,
              cw.dueTime?.hours ?? 23,
              cw.dueTime?.minutes ?? 59,
            );
            return due >= now && due <= twoWeeksOut;
          })
          .map((cw) => {
            const due = new Date(
              cw.dueDate!.year,
              cw.dueDate!.month - 1,
              cw.dueDate!.day,
              cw.dueTime?.hours ?? 23,
              cw.dueTime?.minutes ?? 59,
            );
            return {
              id: cw.id,
              title: cw.title,
              dueDate: due.toISOString(),
              courseId: course.id,
              courseName: course.name,
              maxPoints: cw.maxPoints ?? null,
            };
          });
        return items;
      } catch {
        return [];
      }
    }),
  );

  return workArrays
    .flat()
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
}
