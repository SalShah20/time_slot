export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-surface-50">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <a href="/" className="text-teal-600 hover:text-teal-700 text-sm mb-8 inline-block">
          &larr; Back to TimeSlot
        </a>

        <h1 className="text-3xl font-bold text-surface-900 mb-2">Privacy Policy</h1>
        <p className="text-surface-500 mb-8">Last updated: March 13, 2026</p>

        <div className="space-y-8 text-surface-700 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">1. Introduction</h2>
            <p>
              TimeSlot is a task scheduling and
              timer application. This Privacy Policy explains how we collect, use, and protect your
              information when you use our service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">2. Information We Collect</h2>
            <h3 className="font-semibold text-surface-800 mt-4 mb-2">Account Information</h3>
            <p>
              When you sign in with Google, we receive your name, email address, and profile picture
              from your Google account. This information is managed by Supabase Authentication.
            </p>

            <h3 className="font-semibold text-surface-800 mt-4 mb-2">Task Data</h3>
            <p>
              We store the tasks you create, including titles, descriptions, tags, priorities,
              deadlines, scheduled times, and completion status. This data is stored in our database
              and is associated with your user account.
            </p>

            <h3 className="font-semibold text-surface-800 mt-4 mb-2">Timer Data</h3>
            <p>
              We store timer session data including start times, pause times, break durations, and
              completed session records to provide you with productivity statistics.
            </p>

            <h3 className="font-semibold text-surface-800 mt-4 mb-2">Google Calendar Data</h3>
            <p>
              If you choose to connect your Google Calendar, we access your calendar events to avoid
              scheduling conflicts. We store a cached copy of your calendar event titles, start times,
              end times, and busy/free status. We also create, update, and delete calendar events on
              your behalf when you create, reschedule, or complete tasks.
            </p>

            <h3 className="font-semibold text-surface-800 mt-4 mb-2">Google Classroom Data</h3>
            <p>
              If you choose to connect Google Classroom, we access your course list and coursework
              (assignments) to automatically import upcoming assignments as tasks. We store a record
              of which assignments have been imported to prevent duplicates. We do not modify any data
              in your Google Classroom account — access is read-only.
            </p>

            <h3 className="font-semibold text-surface-800 mt-4 mb-2">Canvas LMS Data</h3>
            <p>
              If you choose to connect Canvas LMS, we use your Canvas API token to fetch upcoming
              assignments from your courses. We store a record of which assignments have been imported
              to prevent duplicates. Your Canvas API token is stored securely in our database and is
              only used to authenticate requests to your institution&apos;s Canvas instance.
            </p>

            <p className="mt-4">
              We request the following Google API scopes:
            </p>
            <ul className="list-disc ml-6 mt-2 space-y-1">
              <li><code className="text-sm bg-surface-100 px-1 rounded">auth/calendar</code> — to read, create, update, and delete calendar events for task scheduling and conflict detection</li>
              <li><code className="text-sm bg-surface-100 px-1 rounded">auth/classroom.courses.readonly</code> — to list your Google Classroom courses (read-only, optional)</li>
              <li><code className="text-sm bg-surface-100 px-1 rounded">auth/classroom.coursework.me.readonly</code> — to read your assignments and due dates (read-only, optional)</li>
            </ul>
            <p className="mt-2 text-sm">
              Google Classroom scopes are only requested when you explicitly choose to connect the
              Classroom integration from Settings. They are not required for core functionality.
            </p>

            <h3 className="font-semibold text-surface-800 mt-4 mb-2">Google OAuth Tokens</h3>
            <p>
              We securely store your Google OAuth access and refresh tokens to maintain your Google
              Calendar and (optionally) Google Classroom connections. These tokens are stored in our
              database and are only used to authenticate API requests to Google services on your behalf.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc ml-6 space-y-2">
              <li>To provide task scheduling and timer functionality</li>
              <li>To automatically schedule tasks around your existing calendar events</li>
              <li>To create and manage Google Calendar events for your scheduled tasks</li>
              <li>To detect and resolve scheduling conflicts</li>
              <li>To provide productivity statistics and task completion tracking</li>
              <li>To estimate task durations using AI (task titles and descriptions may be sent to OpenAI&apos;s API for duration estimation)</li>
              <li>To import assignments from Google Classroom and Canvas LMS as tasks (when connected)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">4. Third-Party Services</h2>
            <p>We use the following third-party services:</p>
            <ul className="list-disc ml-6 mt-2 space-y-2">
              <li>
                <strong>Supabase</strong> — for authentication and database storage. See{" "}
                <a href="https://supabase.com/privacy" className="text-teal-600 hover:underline" target="_blank" rel="noopener noreferrer">
                  Supabase Privacy Policy
                </a>.
              </li>
              <li>
                <strong>Google APIs</strong> — for Google Sign-In and Google Calendar integration. See{" "}
                <a href="https://policies.google.com/privacy" className="text-teal-600 hover:underline" target="_blank" rel="noopener noreferrer">
                  Google Privacy Policy
                </a>.
              </li>
              <li>
                <strong>OpenAI</strong> — for AI-powered task scheduling and duration estimation. Task
                titles, descriptions, and tags may be sent to OpenAI. See{" "}
                <a href="https://openai.com/privacy" className="text-teal-600 hover:underline" target="_blank" rel="noopener noreferrer">
                  OpenAI Privacy Policy
                </a>.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">5. Data Storage and Security</h2>
            <p>
              Your data is stored securely in Supabase with row-level security (RLS) policies ensuring
              that users can only access their own data. All data transmission is encrypted using HTTPS.
              Google OAuth tokens are stored securely in our database and are never exposed to the client.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">6. Data Retention and Deletion</h2>
            <p>
              Your data is retained as long as your account is active. You can request deletion of your
              account and all associated data by contacting us. Upon deletion, we will remove all your
              tasks, timer sessions, calendar data, and stored OAuth tokens.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">7. Google API Services User Data Policy</h2>
            <p>
              TimeSlot&apos;s use and transfer of information received from Google APIs adheres to the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                className="text-teal-600 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
            </p>
            <p className="mt-2">Specifically:</p>
            <ul className="list-disc ml-6 mt-2 space-y-2">
              <li>We only use Google Calendar and Google Classroom data to provide and improve task scheduling features</li>
              <li>We do not sell your Google data to third parties</li>
              <li>We do not use your Google data for advertising purposes</li>
              <li>We do not allow humans to read your Google data unless required for security purposes, to comply with applicable law, or with your explicit consent</li>
              <li>Our use of Google data is limited to providing the functionality described in this policy</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">8. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc ml-6 mt-2 space-y-2">
              <li>Access the personal data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Disconnect your Google Calendar at any time by revoking access in your{" "}
                <a href="https://myaccount.google.com/permissions" className="text-teal-600 hover:underline" target="_blank" rel="noopener noreferrer">
                  Google Account settings
                </a>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">9. Children&apos;s Privacy</h2>
            <p>
              TimeSlot is not intended for children under the age of 13. We do not knowingly collect
              personal information from children under 13.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">10. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify users of any material
              changes by updating the &quot;Last updated&quot; date at the top of this page.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">11. Contact</h2>
            <p>
              If you have questions about this Privacy Policy or wish to exercise your data rights,
              please contact us through{" "}
              <a href="https://salonishah.net" className="text-teal-600 hover:underline" target="_blank" rel="noopener noreferrer">
                salonishah.net
              </a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
