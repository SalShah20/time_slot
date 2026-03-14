export interface CanvasAssignment {
  id: number;
  name: string;
  due_at: string | null;
  course_id: number;
  course_name?: string;
  points_possible: number | null;
  submission_types: string[];
  has_submitted_submissions: boolean;
}

interface CanvasCourse {
  id: number;
  name: string;
}

/**
 * Fetches upcoming (next 14 days) unsubmitted assignments from Canvas LMS.
 * Queries active courses, then fetches upcoming assignments per course in parallel.
 */
export async function fetchUpcomingAssignments(
  domain: string,
  token: string,
): Promise<CanvasAssignment[]> {
  const baseUrl = `https://${domain}/api/v1`;
  const headers = { Authorization: `Bearer ${token}` };

  const coursesRes = await fetch(
    `${baseUrl}/courses?enrollment_state=active&per_page=50`,
    { headers },
  );
  if (!coursesRes.ok) {
    throw new Error(`Canvas API error: ${coursesRes.status}`);
  }
  const courses: CanvasCourse[] = await coursesRes.json();

  const now = new Date();
  const twoWeeksOut = new Date(now.getTime() + 14 * 24 * 60 * 60_000);

  const assignmentArrays = await Promise.all(
    courses.map(async (course) => {
      try {
        const res = await fetch(
          `${baseUrl}/courses/${course.id}/assignments?bucket=upcoming&per_page=50&order_by=due_at`,
          { headers },
        );
        if (!res.ok) return [];
        const assignments: CanvasAssignment[] = await res.json();
        return assignments
          .filter((a) => {
            if (!a.due_at) return false;
            const due = new Date(a.due_at);
            return due >= now && due <= twoWeeksOut && !a.has_submitted_submissions;
          })
          .map((a) => ({ ...a, course_name: course.name }));
      } catch {
        return [];
      }
    }),
  );

  return assignmentArrays
    .flat()
    .sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime());
}

/**
 * Validates Canvas credentials by calling /api/v1/users/self.
 * Returns true if the token + domain are valid.
 */
export async function validateCanvasCredentials(
  domain: string,
  token: string,
): Promise<boolean> {
  try {
    const res = await fetch(`https://${domain}/api/v1/users/self`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
