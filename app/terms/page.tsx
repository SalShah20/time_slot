export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-surface-50">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <a href="/" className="text-teal-600 hover:text-teal-700 text-sm mb-8 inline-block">
          &larr; Back to TimeSlot
        </a>

        <h1 className="text-3xl font-bold text-surface-900 mb-2">Terms of Service</h1>
        <p className="text-surface-500 mb-8">Last updated: March 10, 2026</p>

        <div className="space-y-8 text-surface-700 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">1. Acceptance of Terms</h2>
            <p>
              By accessing or using TimeSlot (&quot;the app&quot;, &quot;our service&quot;), you agree
              to be bound by these Terms of Service. If you do not agree to these terms, do not use the
              app.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">2. Description of Service</h2>
            <p>
              TimeSlot is a task scheduling and productivity application that helps users organize
              their tasks, schedule them into their calendar, and track time spent on tasks. The app
              integrates with Google Calendar to provide scheduling features and uses AI to assist
              with task scheduling and duration estimation.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">3. Account Registration</h2>
            <p>
              You must sign in with a Google account to use TimeSlot. You are responsible for
              maintaining the security of your account and for all activities that occur under your
              account. You must provide accurate and complete information when creating your account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">4. Google Calendar Integration</h2>
            <p>
              TimeSlot offers optional integration with Google Calendar. By connecting your Google
              Calendar, you authorize TimeSlot to:
            </p>
            <ul className="list-disc ml-6 mt-2 space-y-2">
              <li>Read your calendar events to detect scheduling conflicts</li>
              <li>Create calendar events for your scheduled tasks</li>
              <li>Update calendar events when tasks are rescheduled</li>
              <li>Delete calendar events when tasks are completed or removed</li>
            </ul>
            <p className="mt-2">
              You can revoke this access at any time through your{" "}
              <a href="https://myaccount.google.com/permissions" className="text-teal-600 hover:underline" target="_blank" rel="noopener noreferrer">
                Google Account settings
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">5. AI-Powered Features</h2>
            <p>
              TimeSlot uses AI (powered by OpenAI) to assist with task scheduling and duration
              estimation. AI-generated suggestions are provided as recommendations and may not always
              be accurate. You can always manually adjust scheduled times and durations.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">6. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc ml-6 mt-2 space-y-2">
              <li>Use the service for any unlawful purpose</li>
              <li>Attempt to gain unauthorized access to the service or its related systems</li>
              <li>Interfere with or disrupt the service or servers</li>
              <li>Use automated means to access the service without our permission</li>
              <li>Reverse engineer, decompile, or disassemble any part of the service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">7. Intellectual Property</h2>
            <p>
              The TimeSlot application, including its design, code, and branding, is owned by us. You
              retain ownership of the content you create (task titles, descriptions, etc.). By using
              the service, you grant us a limited license to store and process your content solely for
              the purpose of providing the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">8. Disclaimer of Warranties</h2>
            <p>
              TimeSlot is provided &quot;as is&quot; and &quot;as available&quot; without warranties of
              any kind, either express or implied. We do not guarantee that the service will be
              uninterrupted, error-free, or secure. AI-generated scheduling suggestions may contain
              errors.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">9. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, we shall not be liable for any indirect,
              incidental, special, consequential, or punitive damages, or any loss of profits or
              data, arising out of or in connection with your use of the service. This includes any
              issues arising from scheduling errors, missed tasks, or calendar synchronization
              problems.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">10. Service Modifications</h2>
            <p>
              We reserve the right to modify, suspend, or discontinue the service at any time, with
              or without notice. We will make reasonable efforts to notify users of significant
              changes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">11. Termination</h2>
            <p>
              We may terminate or suspend your access to the service at any time for violation of
              these terms. You may stop using the service at any time. Upon termination, your right
              to use the service will cease immediately.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">12. Changes to Terms</h2>
            <p>
              We may update these Terms of Service from time to time. Continued use of the service
              after changes constitutes acceptance of the updated terms. We will update the
              &quot;Last updated&quot; date at the top of this page for any changes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-surface-900 mb-3">13. Contact</h2>
            <p>
              If you have questions about these Terms of Service, please contact us at{" "}
              <a href="mailto:isalonishah@gmail.com" className="text-teal-600 hover:underline">
                isalonishah@gmail.com
              </a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
