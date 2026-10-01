import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  LayoutDashboard,
  CalendarCheck,
  FileText,
  ShieldCheck,
  BriefcaseBusiness,
  Users,
  Settings as SettingsIcon,
  Menu,
  X,
  Lock,
  Sun,
  Moon,
  Car,
  MessageCircle,
  ExternalLink,
  AlertTriangle,
  ClipboardList,
  UserRound
} from 'lucide-react';
import './styles.css';

localStorage.removeItem('studioTheme');

const W_LOGO = '/studio/studio-assets/windscreen-logo-clean.png?v=5m';
const V_LOGO = '/studio/studio-assets/visionco-logo.png?v=5m';

const TABS = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['bookings', 'Bookings', CalendarCheck],
  ['quotes', 'Quotes', FileText],
  ['claims', 'Insurance Claims', ShieldCheck],
  ['jobs', 'Jobs', BriefcaseBusiness],
  ['customers', 'Customers', Users],
  ['settings', 'Settings', SettingsIcon]
];

function cx(...v) {
  return v.filter(Boolean).join(' ');
}

function money(v) {
  return `$${Number(v || 0).toFixed(2)}`;
}

function statusClass(v = '') {
  const s = String(v).toLowerCase();
  if (s.includes('approved') || s.includes('paid') || s.includes('completed')) return 'good';
  if (s.includes('attention') || s.includes('rejected')) return 'bad';
  if (s.includes('review') || s.includes('pending')) return 'warn';
  if (s.includes('process') || s.includes('submitted') || s.includes('insurance')) return 'blue';
  return 'neutral';
}

function useTheme() {
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  return [theme, setTheme];
}

function SafeLogo({ src, className = '', fallback = 'VC' }) {
  const [bad, setBad] = useState(false);
  if (bad) return <div className={cx('logo-fallback', className)}>{fallback}</div>;
  return <img src={src} className={className} onError={() => setBad(true)} alt="" />;
}

function MadeBy() {
  return (
    <div className="made-by">
      <span className="visionco-squircle">
        <SafeLogo src={V_LOGO} className="made-logo" fallback="VC" />
      </span>
      <span>made by VisionCo.</span>
    </div>
  );
}

function Badge({ children }) {
  return <em className={cx('badge', statusClass(children))}>{children || 'New'}</em>;
}

function CountUp({ value }) {
  const [n, setN] = useState(0);

  useEffect(() => {
    const target = Number(value || 0);
    let frame = 0;
    const total = 34;
    const timer = setInterval(() => {
      frame += 1;
      const progress = frame / total;
      const eased = 1 - Math.pow(1 - progress, 3);
      setN(Math.round(target * eased));
      if (frame >= total) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [value]);

  return <>{n.toLocaleString()}</>;
}

function SpotlightCard({ children, className = '', as: Tag = 'div', ...props }) {
  const ref = useRef(null);

  function onMove(e) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  }

  return (
    <Tag ref={ref} onMouseMove={onMove} className={cx('spotlight-card', className)} {...props}>
      {children}
    </Tag>
  );
}

function SplitTitle({ children }) {
  return (
    <h1 className="split-title">
      {String(children).split(' ').map((word, i) => (
        <span key={`${word}-${i}`} style={{ animationDelay: `${i * 50}ms` }}>{word}</span>
      ))}
    </h1>
  );
}

function Login({ onLogin }) {
  const [pin, setPin] = useState('');

  return (
    <main className="login-final">
      <section className="login-panel">
        <div className="login-brand">
          <SafeLogo src={W_LOGO} className="business-logo" fallback="AG" />
          <div>
            <strong>Windscreen</strong>
            <span>Automation Dashboard</span>
          </div>
        </div>

        <div className="login-form">
          <p className="login-kicker">SECURE WORKSHOP LOGIN</p>
          <h1>Welcome back.</h1>
          <h3>Manage bookings, quotes, insurance claims, jobs and customer files from one clean dashboard.</h3>

          <label>Admin PIN</label>
          <input
            value={pin}
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onLogin(pin)}
            type="password"
            placeholder="Enter your PIN"
            autoFocus
          />

          <button className="primary login-button" onClick={() => onLogin(pin)}>Log in</button>
        </div>

        <MadeBy />
      </section>

      <section className="login-art">
        <div className="login-orb one" />
        <div className="login-orb two" />
        <div className="login-grid" />

        <div className="login-art-copy">
          <SafeLogo src={W_LOGO} className="hero-logo" fallback="AUTO" />
          <span>SMART AUTO GLASS WORKFLOW</span>
          <h2>From WhatsApp enquiry to completed windscreen job.</h2>
          <p>Every claim, document, customer update and job status is organised inside one simple workshop system.</p>
        </div>

        <div className="floating-card card-one">
          <strong>Insurance Claims</strong>
          <small>Forms, IDs, licences and damage photos.</small>
        </div>

        <div className="floating-card card-two">
          <strong>Customer Files</strong>
          <small>Click a customer name and see everything.</small>
        </div>

        <div className="floating-card card-three">
          <strong>Workshop Progress</strong>
          <small>Bookings, quotes, jobs and updates.</small>
        </div>
      </section>
    </main>
  );
}

function Shell({ active, setActive, logout, children }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const activeLabel = TABS.find(([key]) => key === active)?.[1] || 'Dashboard';

  function openTab(key) {
    setActive(key);
    setMobileMenuOpen(false);
  }

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <SafeLogo src={W_LOGO} className="side-logo" fallback="AG" />
          <div className="brand-name">
            <strong>Windscreen</strong>
            <span>Automation Dashboard</span>
          </div>
        </div>

        <nav>
          {TABS.map(([key, label, Icon]) => (
            <button key={key} className={active === key ? 'active' : ''} onClick={() => setActive(key)}>
              <span className="nav-icon"><Icon size={18} strokeWidth={2.25} /></span>
              <b>{label}</b>
            </button>
          ))}
        </nav>

        <div className="side-bottom">
          <button onClick={logout}><Lock size={16} strokeWidth={2.2} /> Lock Dashboard</button>
          <MadeBy />
        </div>
      </aside>

      <main>
        <div className="mobile-appbar">
          <button className="burger-btn" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu">
            <Menu size={23} strokeWidth={2.4} />
          </button>

          <div className="mobile-brand">
            <SafeLogo src={W_LOGO} className="mobile-logo" fallback="AG" />
            <div>
              <strong>Windscreen</strong>
              <span>{activeLabel}</span>
            </div>
          </div>
        </div>

        {mobileMenuOpen && <div className="mobile-drawer-backdrop" onClick={() => setMobileMenuOpen(false)} />}

        <div className={cx('mobile-drawer', mobileMenuOpen && 'open')}>
          <div className="mobile-drawer-head">
            <div className="mobile-drawer-brand">
              <SafeLogo src={W_LOGO} className="mobile-drawer-logo" fallback="AG" />
              <div>
                <strong>Windscreen</strong>
                <span>Automation Dashboard</span>
              </div>
            </div>

            <button className="mobile-close" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu">
              <X size={23} strokeWidth={2.4} />
            </button>
          </div>

          <div className="mobile-drawer-nav">
            {TABS.map(([key, label, Icon]) => (
              <button key={key} className={active === key ? 'active' : ''} onClick={() => openTab(key)}>
                <span><Icon size={18} strokeWidth={2.25} /></span>
                <b>{label}</b>
              </button>
            ))}
          </div>

          <div className="mobile-drawer-actions">
            <button onClick={() => { logout(); setMobileMenuOpen(false); }}>
              <Lock size={16} strokeWidth={2.2} /> Lock Dashboard
            </button>
            <MadeBy />
          </div>
        </div>

        {children}
      </main>
    </div>
  );
}

function Page({ title, sub, children }) {
  return (
    <div className="page">
      <div className="page-inner">
        <div className="title">
          <SplitTitle>{title}</SplitTitle>
          <p>{sub}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon }) {
  return (
    <SpotlightCard className="stat-card">
      <div className="stat-top">
        <div>
          <span>{label}</span>
          <strong><CountUp value={value} /></strong>
        </div>
        <i><Icon size={22} strokeWidth={2.15} /></i>
      </div>
      <small>{sub}</small>
    </SpotlightCard>
  );
}

function SectionHead({ title, action, onClick }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {action && <button onClick={onClick}>{action}</button>}
    </div>
  );
}

function EmptyState({ title = 'No records yet', copy = 'New records from the WhatsApp automation will appear here automatically.', columns = [] }) {
  return (
    <div className="empty-box">
      {columns.length > 0 && (
        <div className="empty-table-head">
          {columns.map(c => <span key={c}>{c}</span>)}
        </div>
      )}
      <div className="empty-content">
        <div className="empty-illustration">
          <ClipboardList size={34} strokeWidth={1.8} />
        </div>
        <strong>{title}</strong>
        <p>{copy}</p>
      </div>
    </div>
  );
}

function Dashboard({ data, setActive }) {
  const s = data.summary || {};

  return (
    <Page title="Dashboard" sub="The main overview for today.">
      <div className="stats-grid">
        <StatCard label="Bookings" value={s.bookings || 0} sub="normal customer bookings" icon={CalendarCheck} />
        <StatCard label="Quotes" value={s.quotes || 0} sub="pricing requests" icon={FileText} />
        <StatCard label="Claims" value={s.claims || 0} sub={`${s.pendingClaims || 0} pending`} icon={ShieldCheck} />
        <StatCard label="Customers" value={s.customers || 0} sub="from WhatsApp" icon={Users} />
      </div>

      <div className="grid2">
        <SpotlightCard className="panel-card">
          <SectionHead title="Latest Insurance Claims" action="Open Claims" onClick={() => setActive('claims')} />
          <RecordList rows={(data.claims || []).slice(0, 7)} onSelect={() => setActive('claims')} />
        </SpotlightCard>

        <SpotlightCard className="panel-card">
          <SectionHead title="Latest Customers" action="Open Customers" onClick={() => setActive('customers')} />
          <CustomerList rows={(data.customers || []).slice(0, 7)} />
        </SpotlightCard>
      </div>

      <MadeBy />
    </Page>
  );
}

function RecordList({ rows, onSelect, selected }) {
  if (!rows?.length) {
    return <EmptyState columns={['Ref', 'Customer', 'Vehicle', 'Status']} />;
  }

  return (
    <div className="list">
      {rows.map(r => (
        <button
          key={`${r.type || 'row'}-${r.ref || r.claimNo || r.jobNo}`}
          onClick={() => onSelect?.(r)}
          className={cx(selected?.ref === r.ref && 'selected')}
        >
          <div>
            <strong>{r.ref || r.claimNo || r.jobNo}</strong>
            <span>{r.customerName || r.customerPhone || '-'}</span>
          </div>
          <div>
            <b>{r.vehicle || r.service || r.insurer || '-'}</b>
            <small>{r.registration || r.type || '-'}</small>
          </div>
          <Badge>{r.publicStatus || r.status}</Badge>
        </button>
      ))}
    </div>
  );
}

function CustomerList({ rows, onSelect, selected }) {
  if (!rows?.length) {
    return <EmptyState title="No customers yet" copy="Customers will appear after they complete a WhatsApp flow." columns={['Customer', 'Phone', 'Vehicle', 'Records']} />;
  }

  return (
    <div className="list customer-list">
      {rows.map(c => (
        <button key={c.phone} className={selected?.phone === c.phone ? 'selected' : ''} onClick={() => onSelect?.(c)}>
          <div>
            <strong>{c.name || c.phone}</strong>
            <span>{c.phone}</span>
          </div>
          <div>
            <b>{c.vehicle || '-'}</b>
            <small>{c.records || 0} records</small>
          </div>
        </button>
      ))}
    </div>
  );
}


function FormModal({ title, fields, onClose, onSubmit }) {
  const [form, setForm] = useState({});

  function setValue(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    await onSubmit(form);
  }

  return (
    <div className="modal-backdrop">
      <form className="modal-card" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <span>New Record</span>
            <h2>{title}</h2>
          </div>
          <button type="button" onClick={onClose}>×</button>
        </div>

        <div className="modal-grid">
          {fields.map(f => (
            <label key={f.key} className={f.large ? 'large' : ''}>
              {f.label}
              {f.type === 'textarea' ? (
                <textarea value={form[f.key] || ''} onChange={e => setValue(f.key, e.target.value)} placeholder={f.placeholder || ''} />
              ) : (
                <input value={form[f.key] || ''} onChange={e => setValue(f.key, e.target.value)} placeholder={f.placeholder || ''} required={f.required} />
              )}
            </label>
          ))}
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit">Save</button>
        </div>
      </form>
    </div>
  );
}

const CUSTOMER_FIELDS = [
  { key: 'phone', label: 'Phone number', placeholder: '+263...', required: true },
  { key: 'name', label: 'Customer name' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'registration', label: 'Registration' },
  { key: 'notes', label: 'Notes', type: 'textarea', large: true }
];

const JOB_FIELDS = [
  { key: 'customerPhone', label: 'Phone number', placeholder: '+263...', required: true },
  { key: 'customerName', label: 'Customer name' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'registration', label: 'Registration' },
  { key: 'service', label: 'Service', placeholder: 'Windscreen Replacement' },
  { key: 'location', label: 'Location' },
  { key: 'notes', label: 'Notes', type: 'textarea', large: true }
];


function WorkPage({ title, sub, rows, type, api, reload }) {
  const [selected, setSelected] = useState(rows?.[0] || null);
  const [modalOpen, setModalOpen] = useState(false);

  const endpoint =
    type === 'Booking' ? '/bookings' :
    type === 'Quote' ? '/quotes' :
    '/jobs';

  const action =
    type === 'Booking' ? 'Create Booking' :
    type === 'Quote' ? 'Create Quote' :
    'Create Job';

  useEffect(() => {
    if (!selected && rows?.[0]) setSelected(rows[0]);
  }, [rows, selected]);

  async function createRecord(form) {
    await api(endpoint, 'POST', form);
    setModalOpen(false);
    await reload();
  }

  async function updateJob(status) {
    await api(`/jobs/${selected.jobNo}/status`, 'POST', { status });
    await reload();
  }

  async function addNote() {
    if (!selected?.jobNo) return;
    const note = prompt('Internal note:');
    if (!note) return;
    await api('/notes', 'POST', { ref: selected.jobNo, type: 'internal', note });
    alert('Note saved.');
  }

  return (
    <Page title={title} sub={sub}>
      <div className="split">
        <SpotlightCard className="panel-card">
          <SectionHead title={title} action={action} onClick={() => setModalOpen(true)} />
          <RecordList rows={rows} onSelect={setSelected} selected={selected} />
        </SpotlightCard>

        <SpotlightCard className="panel-card sticky">
          {!selected ? (
            <EmptyState title={`No ${title.toLowerCase()} yet`} />
          ) : (
            <>
              <DetailHead label={type} refNo={selected.ref || selected.jobNo} status={selected.publicStatus} />
              <InfoGrid items={[
                ['Customer', selected.customerName],
                ['Phone', selected.customerPhone],
                ['Vehicle', selected.vehicle],
                ['Registration', selected.registration],
                ['Service', selected.service],
                ['Location', selected.location]
              ]} />
              {selected.jobNo && (
                <div className="actions">
                  <button className="primary" onClick={() => updateJob('in_progress')}>In Progress</button>
                  <button className="primary" onClick={() => updateJob('completed')}>Completed</button>
                  <button onClick={() => updateJob('waiting_parts')}>Waiting Parts</button>
                  <button onClick={() => updateJob('closed')}>Closed</button>
                  <button onClick={addNote}>Add Internal Note</button>
                </div>
              )}
            </>
          )}
        </SpotlightCard>
      </div>

      {modalOpen && (
        <FormModal
          title={action}
          fields={JOB_FIELDS}
          onClose={() => setModalOpen(false)}
          onSubmit={createRecord}
        />
      )}

      <MadeBy />
    </Page>
  );
}
) {
  const [selected, setSelected] = useState(rows?.[0] || null);

  useEffect(() => {
    if (!selected && rows?.[0]) setSelected(rows[0]);
  }, [rows, selected]);

  async function updateJob(status) {
    await api(`/jobs/${selected.jobNo}/status`, 'POST', { status });
    await reload();
  }

  return (
    <Page title={title} sub={sub}>
      <div className="split">
        <SpotlightCard className="panel-card">
          <SectionHead title={title} />
          <RecordList rows={rows} onSelect={setSelected} selected={selected} />
        </SpotlightCard>

        <SpotlightCard className="panel-card sticky">
          {!selected ? (
            <EmptyState title={`No ${title.toLowerCase()} yet`} />
          ) : (
            <>
              <DetailHead label={type} refNo={selected.ref || selected.jobNo} status={selected.publicStatus} />
              <InfoGrid items={[
                ['Customer', selected.customerName],
                ['Phone', selected.customerPhone],
                ['Vehicle', selected.vehicle],
                ['Registration', selected.registration],
                ['Service', selected.service],
                ['Location', selected.location]
              ]} />
              {selected.jobNo && (
                <div className="actions">
                  <button className="primary" onClick={() => updateJob('in_progress')}>In Progress</button>
                  <button className="primary" onClick={() => updateJob('completed')}>Completed</button>
                  <button onClick={() => updateJob('waiting_parts')}>Waiting Parts</button>
                  <button onClick={() => updateJob('closed')}>Closed</button>
                </div>
              )}
            </>
          )}
        </SpotlightCard>
      </div>

      <MadeBy />
    </Page>
  );
}

function Claims({ data, api, reload }) {
  const rows = data.claims || [];
  const [selected, setSelected] = useState(rows[0] || null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!selected && rows[0]) setSelected(rows[0]);
  }, [rows, selected]);

  async function status(s) {
    await api(`/claims/${selected.claimNo}/status`, 'POST', { status: s, note, notify: true });
    setNote('');
    await reload();
  }

  async function submitPOS() {
    await api(`/claims/${selected.claimNo}/submit-pos`, 'POST', {});
    await reload();
  }

  async function messageCustomer() {
    const msg = prompt('Message to customer:');
    if (!msg) return;
    await api('/message', 'POST', { phone: selected.customerPhone, message: msg });
    alert('Message sent.');
  }

  return (
    <Page title="Insurance Claims" sub="Manage claim forms, insurance status and POS submission.">
      <div className="split">
        <SpotlightCard className="panel-card">
          <SectionHead title="Claims" />
          <RecordList rows={rows} onSelect={setSelected} selected={selected} />
        </SpotlightCard>

        <SpotlightCard className="panel-card sticky">
          {!selected ? (
            <EmptyState title="No insurance claims yet" copy="Claims will appear here after customers complete the claim form on WhatsApp." />
          ) : (
            <>
              <DetailHead label="Insurance Claim" refNo={selected.claimNo} status={selected.publicStatus} />
              <InfoGrid items={[
                ['Customer', selected.customerName],
                ['Phone', selected.customerPhone],
                ['Insurer', selected.insurer],
                ['Vehicle', selected.vehicle],
                ['Registration', selected.registration],
                ['POS Ref', selected.posRef || 'Not submitted']
              ]} />
              <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Optional customer note..." />
              <div className="actions">
                <button className="primary" onClick={() => status('submitted')}>Sent to Insurance</button>
                <button className="primary" onClick={() => status('approved')}>Approved</button>
                <button onClick={() => status('review')}>Needs Review</button>
                <button onClick={() => status('rejected')}>Rejected</button>
                <button onClick={submitPOS}>Submit to POS</button>
                {selected.pdfUrl && <a href={selected.pdfUrl} target="_blank" rel="noreferrer">Open Claim PDF <ExternalLink size={14} /></a>}
                {selected.customerPhone && <button onClick={messageCustomer}><MessageCircle size={15} /> Message Customer</button>}
              </div>
            </>
          )}
        </SpotlightCard>
      </div>

      <MadeBy />
    </Page>
  );
}


function Customers({ data, api, reload }) {
  const customers = data.customers || [];
  const [selected, setSelected] = useState(customers[0] || null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!selected && customers[0]) setSelected(customers[0]);
  }, [customers, selected]);

  const phone = selected?.phone;
  const claims = (data.claims || []).filter(x => x.customerPhone === phone);
  const jobs = (data.jobs || []).filter(x => x.customerPhone === phone);
  const docs = (data.documents || []).filter(x =>
    x.phone === phone ||
    claims.some(c => c.claimNo === x.claimNo) ||
    jobs.some(j => j.jobNo === x.jobNo)
  );

  async function createCustomer(form) {
    await api('/customers', 'POST', form);
    setModalOpen(false);
    await reload();
  }

  async function messageCustomer() {
    const msg = prompt('Message to customer:');
    if (!msg || !phone) return;
    await api('/message', 'POST', { phone, message: msg });
    alert('Message sent.');
  }

  async function addNote() {
    if (!phone) return;
    const note = prompt('Internal customer note:');
    if (!note) return;
    await api('/notes', 'POST', { ref: phone, type: 'customer_note', note });
    alert('Note saved.');
  }

  return (
    <Page title="Customers" sub="Click a customer to see their claims, jobs, images and documents.">
      <div className="split">
        <SpotlightCard className="panel-card">
          <SectionHead title="Customer List" action="Add Customer" onClick={() => setModalOpen(true)} />
          <CustomerList rows={customers} selected={selected} onSelect={setSelected} />
        </SpotlightCard>

        <SpotlightCard className="panel-card sticky">
          {!selected ? (
            <EmptyState title="No customer selected" />
          ) : (
            <>
              <DetailHead label="Customer Profile" refNo={selected.name || selected.phone} status={`${selected.records || 0} records`} />
              <InfoGrid items={[
                ['Phone', selected.phone],
                ['Vehicle', selected.vehicle],
                ['Registration', selected.registration],
                ['Claims', claims.length],
                ['Jobs', jobs.length],
                ['Documents', docs.length]
              ]} />
              <div className="actions">
                <button className="primary" onClick={messageCustomer}><MessageCircle size={15} /> Message Customer</button>
                <button onClick={addNote}>Add Internal Note</button>
              </div>

              <MiniSection title="Insurance Claims" rows={claims} />
              <MiniSection title="Jobs / Bookings" rows={jobs} />
              <DocumentsBlock docs={docs} />
            </>
          )}
        </SpotlightCard>
      </div>

      {modalOpen && (
        <FormModal
          title="Add Customer"
          fields={CUSTOMER_FIELDS}
          onClose={() => setModalOpen(false)}
          onSubmit={createCustomer}
        />
      )}

      <MadeBy />
    </Page>
  );
}
) {
  const customers = data.customers || [];
  const [selected, setSelected] = useState(customers[0] || null);

  useEffect(() => {
    if (!selected && customers[0]) setSelected(customers[0]);
  }, [customers, selected]);

  const phone = selected?.phone;
  const claims = (data.claims || []).filter(x => x.customerPhone === phone);
  const jobs = (data.jobs || []).filter(x => x.customerPhone === phone);
  const docs = (data.documents || []).filter(x =>
    x.phone === phone ||
    claims.some(c => c.claimNo === x.claimNo) ||
    jobs.some(j => j.jobNo === x.jobNo)
  );

  async function messageCustomer() {
    const msg = prompt('Message to customer:');
    if (!msg || !phone) return;
    await api('/message', 'POST', { phone, message: msg });
    alert('Message sent.');
  }

  return (
    <Page title="Customers" sub="Click a customer to see their claims, jobs, images and documents.">
      <div className="split">
        <SpotlightCard className="panel-card">
          <SectionHead title="Customer List" />
          <CustomerList rows={customers} selected={selected} onSelect={setSelected} />
        </SpotlightCard>

        <SpotlightCard className="panel-card sticky">
          {!selected ? (
            <EmptyState title="No customer selected" />
          ) : (
            <>
              <DetailHead label="Customer Profile" refNo={selected.name || selected.phone} status={`${selected.records || 0} records`} />
              <InfoGrid items={[
                ['Phone', selected.phone],
                ['Vehicle', selected.vehicle],
                ['Registration', selected.registration],
                ['Claims', claims.length],
                ['Jobs', jobs.length],
                ['Documents', docs.length]
              ]} />
              <div className="actions single">
                <button className="primary" onClick={messageCustomer}><MessageCircle size={15} /> Message Customer</button>
              </div>

              <MiniSection title="Insurance Claims" rows={claims} />
              <MiniSection title="Jobs / Bookings" rows={jobs} />
              <DocumentsBlock docs={docs} />
            </>
          )}
        </SpotlightCard>
      </div>

      <MadeBy />
    </Page>
  );
}

function DocumentsBlock({ docs }) {
  return (
    <div className="mini">
      <h3>Images & Documents</h3>
      {!docs.length ? (
        <EmptyState title="No documents for this customer" copy="Uploaded IDs, licences, PDFs and photos will show here." />
      ) : (
        <div className="docs-grid">
          {docs.map(d => (
            <a key={d.id} href={d.url} target="_blank" rel="noreferrer">
              <span>{d.type || 'Document'}</span>
              <b>{d.ref || d.phone || '-'}</b>
              <small>{d.caption || d.createdAt || 'Open file'}</small>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniSection({ title, rows }) {
  return (
    <div className="mini">
      <h3>{title}</h3>
      <RecordList rows={rows || []} />
    </div>
  );
}

function Settings({ data, api, reload, logout, theme, setTheme }) {
  async function resetData() {
    const ok = prompt('Type RESET to clear all dashboard test records. Services/settings stay.');
    if (ok !== 'RESET') return;
    await api('/reset-data', 'POST', { confirm: 'RESET' });
    await reload();
    alert('Dashboard records reset.');
  }

  return (
    <Page title="Settings" sub="Business, appearance and system controls.">
      <div className="settings-grid">
        <SpotlightCard className="panel-card">
          <SectionHead title="Business Details" />
          <InfoGrid one items={[
            ['Business', data.config?.business],
            ['Base URL', data.config?.baseUrl]
          ]} />
        </SpotlightCard>

        <SpotlightCard className="panel-card">
          <SectionHead title="POS Integration" />
          <InfoGrid one items={[
            ['POS Connected', data.config?.posConnected ? 'Yes' : 'No'],
            ['Shop', data.config?.shopName || '-'],
            ['Terminal', data.config?.terminalName || '-']
          ]} />
        </SpotlightCard>

        <SpotlightCard className="panel-card">
          <SectionHead title="Appearance" />
          <p className="muted">Change the dashboard theme here.</p>
          <div className="actions">
            <button className={theme === 'light' ? 'primary' : ''} onClick={() => setTheme('light')}>
              <Sun size={16} strokeWidth={2.2} /> Light Theme
            </button>
            <button className={theme === 'dark' ? 'primary' : ''} onClick={() => setTheme('dark')}>
              <Moon size={16} strokeWidth={2.2} /> Dark Theme
            </button>
          </div>
        </SpotlightCard>

        <SpotlightCard className="panel-card danger-card">
          <SectionHead title="Danger Zone" />
          <p className="muted">Only use this after testing when you want a clean dashboard.</p>
          <div className="actions">
            <button className="danger-button" onClick={resetData}><AlertTriangle size={16} /> Reset Dashboard Data</button>
            <button onClick={logout}><Lock size={16} /> Lock Dashboard</button>
          </div>
        </SpotlightCard>
      </div>

      <MadeBy />
    </Page>
  );
}

function DetailHead({ label, refNo, status }) {
  return (
    <div className="detail-head">
      <div>
        <span>{label}</span>
        <h2>{refNo}</h2>
      </div>
      <Badge>{status}</Badge>
    </div>
  );
}

function InfoGrid({ items, one }) {
  return (
    <div className={cx('info-grid', one && 'one')}>
      {items.map(([k, v]) => (
        <label key={k}>{k}<b>{String(v ?? '-')}</b></label>
      ))}
    </div>
  );
}

function Loading({ error, reset }) {
  return (
    <main className="loading">
      <SafeLogo src={W_LOGO} className="loading-logo" fallback="AG" />
      <h2>{error ? 'Access failed' : 'Loading dashboard...'}</h2>
      <p>{error || 'Preparing records.'}</p>
      {error && <button className="primary" onClick={reset}>Try PIN Again</button>}
      <MadeBy />
    </main>
  );
}

function App() {
  const [theme, setTheme] = useTheme();
  const [pin, setPin] = useState(localStorage.getItem('studioPin') || '');
  const [active, setActive] = useState('dashboard');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  async function api(path, method = 'GET', body) {
    const res = await fetch(`/api/studio/v3${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-admin-pin': pin },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) throw new Error(json.error || 'Request failed');
    return json;
  }

  async function load() {
    try {
      setError('');
      setData(await api('/state'));
    } catch (e) {
      setData(null);
      setError(e.message);
    }
  }

  useEffect(() => {
    if (pin) load();
  }, [pin]);

  function login(v) {
    localStorage.setItem('studioPin', v);
    setPin(v);
  }

  function logout() {
    localStorage.removeItem('studioPin');
    setPin('');
    setData(null);
    setError('');
  }

  if (!pin || error === 'Invalid or missing admin PIN.') return <Login onLogin={login} />;
  if (!data) return <Loading error={error} reset={logout} />;

  const pages = {
    dashboard: <Dashboard data={data} setActive={setActive} />,
    bookings: <WorkPage title="Bookings" sub="Normal customer bookings from WhatsApp." rows={data.bookings || []} type="Booking" api={api} reload={load} />,
    quotes: <WorkPage title="Quotes" sub="Customers asking for prices or estimates." rows={data.quotes || []} type="Quote" api={api} reload={load} />,
    claims: <Claims data={data} api={api} reload={load} />,
    jobs: <WorkPage title="Jobs" sub="Workshop jobs and work progress." rows={data.jobs || []} type="Job" api={api} reload={load} />,
    customers: <Customers data={data} api={api} reload={load} />,
    settings: <Settings data={data} api={api} reload={load} logout={logout} theme={theme} setTheme={setTheme} />
  };

  return (
    <Shell active={active} setActive={setActive} logout={logout}>
      {pages[active]}
    </Shell>
  );
}

createRoot(document.getElementById('root')).render(<App />);
