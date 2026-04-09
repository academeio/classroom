import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Faculty Guide — Academe Classroom',
  description: 'How to generate and embed AI-powered interactive classrooms in Canvas LMS',
};

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <h1 className="text-3xl font-bold text-gray-900">Faculty Guide</h1>
          <p className="mt-2 text-gray-600">
            How to create and deploy AI-powered interactive classrooms for your students
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-12">
        {/* Section 1: Generating a Classroom */}
        <section>
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">
            1. Generating a Classroom
          </h2>
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
            <p className="text-gray-700">
              Each interactive classroom is generated from CBME competencies. Here is the step-by-step process:
            </p>
            <ol className="list-decimal list-inside space-y-3 text-gray-700">
              <li>
                <span className="font-medium">Sign in</span> — Go to the home page and enter the faculty password.
              </li>
              <li>
                <span className="font-medium">Select competencies</span> — Use the competency selector to pick
                one or more competencies for the session. You can search by subject, topic, or competency code.
              </li>
              <li>
                <span className="font-medium">Describe the session (optional)</span> — Add any additional
                instructions, clinical scenarios, or focus areas in the text prompt.
              </li>
              <li>
                <span className="font-medium">Generate</span> — Click the generate button. The AI will create
                a multi-slide interactive classroom with teacher narration, student discussions, and assessments.
              </li>
              <li>
                <span className="font-medium">Preview</span> — Review the generated classroom in the preview page.
                You can regenerate if needed.
              </li>
              <li>
                <span className="font-medium">Copy the URL</span> — Once satisfied, copy the classroom URL
                (e.g., <code className="bg-gray-100 px-2 py-0.5 rounded text-sm">https://classroom.cbme.in/classroom/abc123</code>).
              </li>
            </ol>
          </div>
        </section>

        {/* Section 2: Adding to Canvas — External URL */}
        <section>
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">
            2. Adding to Canvas — External URL Method
          </h2>
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
            <p className="text-gray-700">
              This is the simplest method. The classroom opens in a new tab when students click the link.
            </p>
            <ol className="list-decimal list-inside space-y-3 text-gray-700">
              <li>Open your course in Canvas and go to <span className="font-medium">Modules</span>.</li>
              <li>
                Click the <span className="font-medium">+</span> button on the module where you want to add
                the classroom.
              </li>
              <li>
                In the &quot;Add&quot; dropdown, select <span className="font-medium">External URL</span>.
              </li>
              <li>
                Paste the classroom URL (e.g.,{' '}
                <code className="bg-gray-100 px-2 py-0.5 rounded text-sm">
                  https://classroom.cbme.in/classroom/abc123
                </code>
                ).
              </li>
              <li>
                Enter a title, e.g., <span className="font-medium">&quot;Interactive Classroom: Brachial Plexus&quot;</span>.
              </li>
              <li>
                Check <span className="font-medium">&quot;Load in a new tab&quot;</span> (recommended for best experience).
              </li>
              <li>Click <span className="font-medium">Add Item</span>.</li>
            </ol>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
              <strong>Tip:</strong> You can also use the CLI automation script to add classrooms to Canvas
              in bulk. Ask your LMS administrator for details.
            </div>
          </div>
        </section>

        {/* Section 3: Adding to Canvas — iframe Embed */}
        <section>
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">
            3. Adding to Canvas — iframe Embed
          </h2>
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
            <p className="text-gray-700">
              This method embeds the classroom directly within a Canvas page, so students don&apos;t leave the LMS.
            </p>
            <ol className="list-decimal list-inside space-y-3 text-gray-700">
              <li>In your Canvas course, go to <span className="font-medium">Pages</span> and create a new page (or edit an existing one).</li>
              <li>Switch to the <span className="font-medium">HTML Editor</span> (click the &lt;/&gt; icon).</li>
              <li>Paste the following HTML snippet, replacing the URL with your classroom URL:</li>
            </ol>
            <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
              <pre className="text-sm text-gray-100">
{`<iframe
  src="https://classroom.cbme.in/classroom/abc123"
  width="100%"
  height="800"
  style="border: none; border-radius: 8px;"
  allow="autoplay; fullscreen"
  allowfullscreen>
</iframe>`}
              </pre>
            </div>
            <ol className="list-decimal list-inside space-y-3 text-gray-700" start={4}>
              <li>Save the page, then add it to the relevant module.</li>
            </ol>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
              <strong>Note:</strong> Your Canvas instance must allow iframes from{' '}
              <code className="bg-amber-100 px-1 rounded">classroom.cbme.in</code> in the Content Security Policy.
              Contact your LMS administrator if the embed does not load.
            </div>
          </div>
        </section>

        {/* Section 4: What Students See */}
        <section>
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">
            4. What Students See During Playback
          </h2>
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
            <p className="text-gray-700">
              When students open a classroom, they experience an AI-powered interactive session with the following
              characters:
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900">AI Teacher</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Delivers the lecture content, asks questions, explains concepts, and guides the classroom
                  discussion based on the selected competencies.
                </p>
              </div>
              <div className="border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900">Ananya — The Diligent Student</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Well-prepared, asks clarifying questions, provides textbook-accurate answers, and helps
                  reinforce key concepts.
                </p>
              </div>
              <div className="border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900">Vikram — The Curious Questioner</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Asks &quot;why&quot; and &quot;how&quot; questions, connects concepts to clinical scenarios, and represents
                  the inquisitive learner.
                </p>
              </div>
              <div className="border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900">Fatima — The Critical Thinker</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Challenges assumptions, brings up differential diagnoses, and encourages deeper analysis
                  of medical concepts.
                </p>
              </div>
              <div className="border rounded-lg p-4 sm:col-span-2">
                <h3 className="font-semibold text-gray-900">Deepak — Teaching Assistant</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Summarises key points, provides mnemonics and study tips, and helps bridge gaps between
                  theory and clinical practice.
                </p>
              </div>
            </div>
            <p className="text-gray-700">
              Students can watch the classroom unfold as these AI agents interact — simulating a real classroom
              discussion. The session includes slides, narration, Q&amp;A exchanges, and assessment questions.
            </p>
          </div>
        </section>

        {/* Section 5: FAQ */}
        <section>
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">
            5. Frequently Asked Questions
          </h2>
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-6">
            <div>
              <h3 className="font-semibold text-gray-900">Which browsers are supported?</h3>
              <p className="text-gray-600 mt-1">
                The classroom works on all modern browsers — Chrome, Firefox, Safari, and Edge. We recommend
                the latest version of Chrome or Firefox for the best experience. Mobile browsers are supported
                but a desktop or tablet is recommended for the full interactive experience.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">How long does generation take?</h3>
              <p className="text-gray-600 mt-1">
                A typical classroom with 3-5 competencies takes 2-4 minutes to generate. Larger sessions with
                more competencies or complex clinical scenarios may take up to 6 minutes. You will see a progress
                indicator during generation.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Do students need to log in?</h3>
              <p className="text-gray-600 mt-1">
                No. Classroom playback is public — anyone with the link can view it. This makes it easy to share
                via Canvas, WhatsApp, or any other channel. Only classroom <em>generation</em> requires faculty
                authentication.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Can I regenerate a classroom?</h3>
              <p className="text-gray-600 mt-1">
                Yes. You can generate a new classroom for the same competencies at any time. Each generation
                produces a unique classroom with a new URL. Previously generated classrooms remain accessible
                at their original URLs.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Can students interact with the classroom?</h3>
              <p className="text-gray-600 mt-1">
                Currently, classrooms are view-only — students watch the AI-driven discussion unfold. Interactive
                features (student participation, live Q&amp;A) are planned for a future release.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Who do I contact for support?</h3>
              <p className="text-gray-600 mt-1">
                For technical issues, contact your LMS administrator. For content or pedagogy questions, reach out
                to the CBME coordination team.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t bg-white mt-12">
        <div className="max-w-4xl mx-auto px-6 py-6 text-center text-sm text-gray-500">
          Academe Classroom — AI-powered interactive classrooms for CBME
        </div>
      </footer>
    </div>
  );
}
