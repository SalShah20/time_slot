import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="w-full px-6 py-4 flex items-center justify-between max-w-5xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-teal-600 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span className="text-xl font-bold text-surface-900">TimeSlot</span>
        </div>
        <Link
          href="/login"
          className="px-4 py-2 text-sm font-medium text-teal-600 border border-teal-600 rounded-lg hover:bg-teal-50 transition-colors"
        >
          Sign in
        </Link>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 md:py-24 bg-gradient-to-b from-white to-teal-50/50">
        <div className="max-w-2xl text-center">
          <h1 className="text-4xl md:text-5xl font-extrabold text-surface-900 leading-tight tracking-tight">
            Stop forgetting.<br />Start doing.
          </h1>
          <p className="mt-5 text-lg md:text-xl text-surface-500 leading-relaxed max-w-xl mx-auto">
            Brain dump your tasks in plain English. TimeSlot uses AI to schedule
            them into your Google Calendar automatically&mdash;no drag and drop,
            no manual planning.
          </p>
          <Link
            href="/login"
            className="inline-block mt-8 px-8 py-3.5 bg-teal-600 text-white text-base font-semibold rounded-xl hover:bg-teal-700 transition-colors shadow-sm"
          >
            Get Started Free
          </Link>
        </div>
      </main>

      {/* How it works */}
      <section className="px-6 py-16 md:py-20 bg-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-surface-900 text-center mb-10">
            How it works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: '\uD83E\uDDE0',
                title: 'Brain dump your tasks',
                desc: 'Type anything naturally\u2014deadlines, duration, priority. A paragraph, a list, whatever works for you.',
              },
              {
                icon: '\u2728',
                title: 'AI schedules everything',
                desc: 'GPT-4o-mini finds free time in your calendar and slots tasks in automatically.',
              },
              {
                icon: '\u2705',
                title: 'Focus and get it done',
                desc: 'Start a timer, work through your day, check things off.',
              },
            ].map((step, i) => (
              <div
                key={i}
                className="bg-white border border-surface-200 rounded-2xl p-6 shadow-sm text-center"
              >
                <div className="text-4xl mb-4">{step.icon}</div>
                <h3 className="text-base font-bold text-surface-900 mb-2">
                  {step.title}
                </h3>
                <p className="text-sm text-surface-500 leading-relaxed">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 border-t border-surface-100">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-surface-400">
          <span>&copy; 2026 TimeSlot &middot; Made for students</span>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-surface-600 transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-surface-600 transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
