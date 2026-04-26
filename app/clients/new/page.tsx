import { LayoutShell } from '@/app/components/LayoutShell';
import { createCompanyAction } from '@/app/companies/actions';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function NewClientPage() {
  return (
    <LayoutShell
      title="Add Client"
      description="A simple setup flow for a new paying clinic. Keep the language client-facing and hide the routing details."
      section="clients"
    >
      <section className="panel panel-stack">
        <div className="metric-label">3-step setup</div>
        <h2 className="section-title">Finish the basics, then open the client workspace.</h2>
        <p className="page-copy">
          This keeps the first setup pass light. Intake and onboarding can fill in deeper details later.
        </p>

        <form action={createCompanyAction} className="panel-stack">
          <section className="panel panel-stack">
            <div className="metric-label">Step 1 of 3</div>
            <h3 className="form-title">Who is this client?</h3>
            <div className="workspace-filter-row">
              <div className="field-stack">
                <label className="key-value-label" htmlFor="new-client-name">
                  Business name
                </label>
                <input
                  id="new-client-name"
                  className="text-input"
                  name="name"
                  placeholder="Glow Med Spa"
                  required
                />
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor="new-client-email">
                  Owner or notification email
                </label>
                <input
                  id="new-client-email"
                  className="text-input"
                  name="notificationEmail"
                  type="email"
                  placeholder="owner@clinic.com"
                />
              </div>
            </div>
          </section>

          <section className="panel panel-stack">
            <div className="metric-label">Step 2 of 3</div>
            <h3 className="form-title">Phone number</h3>
            <p className="page-copy">
              If you already know the Telnyx number this client should use, enter it here. If not, leave it blank and finish the workspace first.
            </p>
            <div className="field-stack">
              <label className="key-value-label" htmlFor="new-client-routing">
                Assigned client number
              </label>
              <textarea
                id="new-client-routing"
                className="text-area"
                name="telnyxInboundNumber"
                rows={3}
                placeholder="+13125550001&#10;+13125550002"
              />
            </div>
          </section>

          <section className="panel panel-stack">
            <div className="metric-label">Step 3 of 3</div>
            <h3 className="form-title">Where should alerts go?</h3>
            <p className="page-copy">
              Use the same notification email for now. You can fine-tune booking alerts and deeper setup inside the client workspace.
            </p>
          </section>

          <div className="inline-actions">
            <button type="submit" className="button" name="nextSurface" value="conversations">
              Finish setup
            </button>
            <Link className="button-ghost" href="/clients">
              Back to clients
            </Link>
          </div>
        </form>
      </section>
    </LayoutShell>
  );
}
