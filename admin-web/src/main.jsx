import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LayoutDashboard, CalendarCheck, FileText, ShieldCheck, BriefcaseBusiness, Users, Settings as SettingsIcon, Menu, X, Lock, Sun, Moon, MessageCircle, ExternalLink, AlertTriangle, ClipboardList, Bell, Search, UserCircle, ArrowRight, CheckCircle2, XCircle, Wifi, Activity, Car, ChevronRight, LogOut, Download, RefreshCw, MapPin, Wrench, Phone } from 'lucide-react';
import './styles.css';
import './redesign.css';


function vpEscapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function vpSafeDashboardMediaUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '#';
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://glass.visionpixels.autos';
    const url = new URL(raw, base);
    if (!['http:', 'https:'].includes(url.protocol)) return '#';
    if (url.origin !== base) return '#';
    if (!/^\/(files|uploads)\//.test(url.pathname)) return '#';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch (_) {
    return '#';
  }
}

function useStudioRefreshPulse(refreshTick, callback) {
  const seenRefreshTick = useRef(refreshTick);
  useEffect(() => {
    if (seenRefreshTick.current === refreshTick) return;
    seenRefreshTick.current = refreshTick;
    callback();
  }, [refreshTick]);
}

async function vpDownloadStudioPdf(path, fallbackName) {
  const pin = localStorage.getItem('studioPin') || '';
  const response = await fetch(`/api/studio/v3${path}`, {
    headers: { 'x-admin-pin': pin },
    cache: 'no-store'
  });
  if (!response.ok) {
    let message = 'Unable to export PDF report.';
    try {
      const json = await response.json();
      if (json?.error) message = json.error;
    } catch (_) {}
    throw new Error(message);
  }
  const blob = await response.blob();
  if (!blob.size || !String(blob.type || '').includes('pdf')) throw new Error('The PDF report was empty or invalid.');
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] || fallbackName || 'monthly-report.pdf';
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// PHASE_9J3_FORCE_VISIBLE_BOOKING_DETAILS
if (typeof window !== 'undefined') {
  const forceVisibleBookingDetails9j3 = () => {
    if (document.querySelector('.exact-bookings-page')) return;
    const pageTitle = Array.from(document.querySelectorAll('h1,h2'))
      .find(x => (x.textContent || '').trim().toLowerCase() === 'bookings');

    if (!pageTitle) return;

    const allPanels = Array.from(document.querySelectorAll('main *'));
    const detailPanel = allPanels.find(el => {
      const txt = el.textContent || '';
      const rect = el.getBoundingClientRect?.();
      return (
        rect &&
        rect.width > 450 &&
        rect.height > 350 &&
        /BOOKING/i.test(txt) &&
        /JC-\d+/i.test(txt) &&
        /Customer/i.test(txt) &&
        /Phone/i.test(txt) &&
        /Vehicle/i.test(txt) &&
        /Registration/i.test(txt)
      );
    });

    if (!detailPanel) return;

    detailPanel.classList.add('booking-client-detail-panel');
    detailPanel.classList.add('booking-force-visible-panel');

    const text = detailPanel.textContent || '';
    const ref = (text.match(/JC-\d+/i) || [''])[0];
    const phone = (text.match(/\+\d{10,15}/) || [''])[0];

    Array.from(detailPanel.querySelectorAll('span,b,em,small,button,div')).forEach(el => {
      const t = (el.textContent || '').trim().toLowerCase();
      if (t === 'new') {
        el.classList.add('booking-status-dynamic');
        el.textContent = 'Pending';
      }
    });

    let extra = detailPanel.querySelector('.booking-client-extra-visible');

    if (!extra) {
      extra = document.createElement('div');
      extra.className = 'booking-client-extra-visible';
      extra.innerHTML = `
        <div class="booking-visible-media-grid">
          <section>
            <h3>Customer Photos</h3>
            <div class="booking-visible-photos">
              <div class="booking-visible-empty">No photos uploaded yet</div>
            </div>
          </section>

          <section>
            <h3>Customer Documents</h3>
            <div class="booking-visible-docs">
              <div class="booking-visible-empty">No documents uploaded yet</div>
            </div>
          </section>
        </div>

        <section class="booking-visible-notes">
          <h3>Customer Notes</h3>
          <p>Customer details captured from the WhatsApp booking flow. Uploaded photos and documents will appear here automatically.</p>
        </section>

        <div class="booking-visible-actions">
          <button type="button" class="booking-visible-proceed">Proceed / Start Job</button>
          <span>Moves this booking from Pending to In Progress.</span>
        </div>
      `;
    }

    // Find the actual customer information grid by looking for the field labels.
    const possibleBlocks = Array.from(detailPanel.querySelectorAll('div, section'));
    let infoBlock = possibleBlocks.find(el => {
      const t = el.textContent || '';
      const r = el.getBoundingClientRect?.();
      return (
        r &&
        r.width > 350 &&
        /Customer/i.test(t) &&
        /Phone/i.test(t) &&
        /Vehicle/i.test(t) &&
        /Registration/i.test(t) &&
        /Service/i.test(t) &&
        /Location/i.test(t) &&
        /Invoice/i.test(t)
      );
    });

    // If the whole panel was matched, use the most likely child block instead.
    if (infoBlock === detailPanel) {
      infoBlock = Array.from(detailPanel.children).find(child => {
        const t = child.textContent || '';
        return /Customer/i.test(t) && /Phone/i.test(t) && /Vehicle/i.test(t) && /Registration/i.test(t);
      });
    }

    if (infoBlock && infoBlock !== extra && extra.previousElementSibling !== infoBlock) {
      infoBlock.insertAdjacentElement('afterend', extra);
    } else if (!detailPanel.contains(extra)) {
      // Fallback: place it after the booking title area, not at the bottom.
      const firstLargeChild = Array.from(detailPanel.children).find(child => /JC-\d+/i.test(child.textContent || ''));
      if (firstLargeChild) firstLargeChild.insertAdjacentElement('afterend', extra);
      else detailPanel.appendChild(extra);
    }

    const pin = localStorage.getItem('adminPin') || localStorage.getItem('pin') || localStorage.getItem('studioPin') || '';

    async function refreshMedia() {
      const photosBox = extra.querySelector('.booking-visible-photos');
      const docsBox = extra.querySelector('.booking-visible-docs');

      try {
        const res = await fetch(`/api/studio/v3/documents`, {
          headers: { 'x-admin-pin': pin },
          cache: 'no-store'
        });

        const json = await res.json();
        const docs = json.documents || [];

        const matching = docs.filter(doc => {
          const docRef = String(doc.ref || doc.jobNo || doc.claimNo || '');
          const docPhone = String(doc.customerPhone || '');
          return (ref && docRef === ref) || (phone && docPhone === phone);
        });

        const photos = matching.filter(doc => {
          const u = String(doc.url || doc.filename || '').toLowerCase();
          const m = String(doc.mimeType || doc.mime_type || '').toLowerCase();
          return m.includes('image') || /\.(jpg|jpeg|png|webp|heic)$/i.test(u);
        });

        const files = matching.filter(doc => !photos.includes(doc));

        photosBox.innerHTML = photos.length ? photos.slice(0, 3).map((doc, i) => `
          <a href="${vpEscapeHtml(vpSafeDashboardMediaUrl(doc.url))}" target="_blank" rel="noreferrer" class="booking-visible-photo">
            <img src="${vpEscapeHtml(vpSafeDashboardMediaUrl(doc.url))}" alt="Customer photo ${i + 1}" />
            <b>${i === 0 ? '' : i === 1 ? '' : ''}</b>
          </a>
        `).join('') : `<div class="booking-visible-empty">No photos uploaded yet</div>`;

        docsBox.innerHTML = files.length ? files.slice(0, 4).map(doc => {
          const name = doc.filename || 'customer-document';
          const url = doc.url || '#';
          const lower = name.toLowerCase();
          const tag = lower.endsWith('.pdf') ? 'PDF' : lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') ? 'JPG' : 'FILE';

          return `
            <a href="${vpEscapeHtml(vpSafeDashboardMediaUrl(url))}" target="_blank" rel="noreferrer" class="booking-visible-doc">
              <span>${tag === 'PDF' ? 'PDF' : 'IMG'}</span>
              <b>${vpEscapeHtml(name)}</b>
              <em>${tag}</em>
              <i>⇩</i>
            </a>
          `;
        }).join('') : `<div class="booking-visible-empty">No documents uploaded yet</div>`;
      } catch {
        photosBox.innerHTML = `<div class="booking-visible-empty">No photos uploaded yet</div>`;
        docsBox.innerHTML = `<div class="booking-visible-empty">No documents uploaded yet</div>`;
      }
    }

    if (!extra.dataset.mediaLoaded) {
      extra.dataset.mediaLoaded = 'yes';
      refreshMedia();
    }

    const btn = extra.querySelector('.booking-visible-proceed');

    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = 'yes';

      btn.addEventListener('click', async () => {
        if (!ref) return;

        btn.disabled = true;
        btn.textContent = 'Processing...';

        try {
          await fetch(`/api/studio/v3/jobs/${encodeURIComponent(ref)}/workflow`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-pin': pin
            },
            body: JSON.stringify({ action: 'in_progress' })
          });

          Array.from(detailPanel.querySelectorAll('.booking-status-dynamic')).forEach(el => {
            el.textContent = 'In Progress';
          });

          btn.textContent = 'In Progress';
        } catch {
          btn.textContent = 'Try Again';
          btn.disabled = false;
        }
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', forceVisibleBookingDetails9j3);
  } else {
    forceVisibleBookingDetails9j3();
  }

  setInterval(forceVisibleBookingDetails9j3, 350);
}


// PHASE_9J2_FORCE_BOOKING_MEDIA_AFTER_INFO_GRID
if (typeof window !== 'undefined') {
  const forceBookingMediaAfterInfo9j2 = () => {
    if (document.querySelector('.exact-bookings-page')) return;
    const isBookingsPage = Array.from(document.querySelectorAll('h1,h2'))
      .some(x => (x.textContent || '').trim().toLowerCase() === 'bookings');

    if (!isBookingsPage) return;

    const detailPanel = Array.from(document.querySelectorAll('.split > div, main .panel-card, main .card, main .spotlight-card'))
      .find(panel => /JC-\d+/i.test(panel.textContent || '') && /Customer/i.test(panel.textContent || '') && /Vehicle/i.test(panel.textContent || ''));

    if (!detailPanel) return;

    detailPanel.classList.add('booking-client-detail-panel');
    detailPanel.classList.add('booking-force-compact');

    const text = detailPanel.textContent || '';
    const refMatch = text.match(/JC-\d+/i);
    const ref = refMatch ? refMatch[0] : '';

    const phoneMatch = text.match(/\+\d{10,15}/);
    const phone = phoneMatch ? phoneMatch[0] : '';

    Array.from(detailPanel.querySelectorAll('span,b,em,small,button,div')).forEach(el => {
      const t = (el.textContent || '').trim().toLowerCase();
      if (t === 'new') {
        el.classList.add('booking-status-dynamic');
        el.textContent = 'Pending';
      }
    });

    let extra = detailPanel.querySelector('.booking-client-extra');

    if (!extra) {
      extra = document.createElement('div');
      extra.className = 'booking-client-extra';
      extra.innerHTML = `
        <div class="booking-media-grid">
          <section>
            <h3>Customer Photos</h3>
            <div class="booking-photo-grid">
              <div class="booking-empty-media">No photos uploaded yet</div>
            </div>
          </section>

          <section>
            <h3>Customer Documents</h3>
            <div class="booking-doc-list">
              <div class="booking-empty-media">No documents uploaded yet</div>
            </div>
          </section>
        </div>

        <section class="booking-client-notes">
          <h3>Customer Notes</h3>
          <p>Customer details captured from the WhatsApp booking flow. Uploaded photos and documents will appear here automatically.</p>
        </section>

        <div class="booking-proceed-row">
          <button class="booking-proceed-btn" type="button">Proceed / Start Job</button>
          <span>This changes the booking from pending to in progress.</span>
        </div>
      `;
    }

    const infoGrid = detailPanel.querySelector('.info-grid, .detail-grid');

    if (infoGrid && extra.previousElementSibling !== infoGrid) {
      infoGrid.insertAdjacentElement('afterend', extra);
    } else if (!detailPanel.contains(extra)) {
      detailPanel.appendChild(extra);
    }

    const pin = localStorage.getItem('adminPin') || localStorage.getItem('pin') || localStorage.getItem('studioPin') || '';

    async function loadDocs() {
      const photosBox = extra.querySelector('.booking-photo-grid');
      const docsBox = extra.querySelector('.booking-doc-list');

      try {
        const res = await fetch(`/api/studio/v3/documents`, {
          headers: { 'x-admin-pin': pin },
          cache: 'no-store'
        });

        const json = await res.json();
        const allDocs = json.documents || [];

        const matching = allDocs.filter(doc => {
          const docRef = String(doc.ref || doc.jobNo || doc.claimNo || '');
          const docPhone = String(doc.customerPhone || '');
          return (ref && docRef === ref) || (phone && docPhone === phone);
        });

        const photos = matching.filter(doc => {
          const u = String(doc.url || doc.filename || '').toLowerCase();
          const m = String(doc.mimeType || doc.mime_type || '').toLowerCase();
          return m.includes('image') || /\.(jpg|jpeg|png|webp|heic)$/i.test(u);
        });

        const files = matching.filter(doc => !photos.includes(doc));

        photosBox.innerHTML = photos.length ? photos.slice(0, 6).map((doc, i) => `
          <a class="booking-photo-card" href="${vpEscapeHtml(vpSafeDashboardMediaUrl(doc.url))}" target="_blank" rel="noreferrer">
            <img src="${vpEscapeHtml(vpSafeDashboardMediaUrl(doc.url))}" alt="Customer upload ${i + 1}" />
            <b>${i === 0 ? '' : i === 1 ? '' : ''}</b>
          </a>
        `).join('') : `<div class="booking-empty-media">No photos uploaded yet</div>`;

        docsBox.innerHTML = files.length ? files.slice(0, 8).map(doc => {
          const url = doc.url || '#';
          const name = doc.filename || 'customer-document';
          const lower = name.toLowerCase();
          const tag = lower.endsWith('.pdf') ? 'PDF' : lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') ? 'JPG' : 'FILE';

          return `
            <a class="booking-doc-row" href="${vpEscapeHtml(vpSafeDashboardMediaUrl(url))}" target="_blank" rel="noreferrer">
              <span>${tag === 'PDF' ? 'PDF' : 'IMG'}</span>
              <b>${vpEscapeHtml(name)}</b>
              <em>${tag}</em>
              <i>⇩</i>
            </a>
          `;
        }).join('') : `<div class="booking-empty-media">No documents uploaded yet</div>`;
      } catch {
        photosBox.innerHTML = `<div class="booking-empty-media">No photos uploaded yet</div>`;
        docsBox.innerHTML = `<div class="booking-empty-media">No documents uploaded yet</div>`;
      }
    }

    if (!extra.dataset.loaded) {
      extra.dataset.loaded = 'yes';
      loadDocs();
    }

    const btn = extra.querySelector('.booking-proceed-btn');

    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = 'yes';

      btn.addEventListener('click', async () => {
        if (!ref) return;

        btn.disabled = true;
        btn.textContent = 'Processing...';

        try {
          await fetch(`/api/studio/v3/jobs/${encodeURIComponent(ref)}/workflow`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-pin': pin
            },
            body: JSON.stringify({ action: 'in_progress' })
          });

          Array.from(detailPanel.querySelectorAll('.booking-status-dynamic')).forEach(el => {
            el.textContent = 'In Progress';
          });

          btn.textContent = 'In Progress';
        } catch {
          btn.textContent = 'Try Again';
          btn.disabled = false;
        }
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', forceBookingMediaAfterInfo9j2);
  } else {
    forceBookingMediaAfterInfo9j2();
  }

  setInterval(forceBookingMediaAfterInfo9j2, 500);
}


// PHASE_9J_BOOKING_CLIENT_DETAIL_VIEW
if (typeof window !== 'undefined') {
  const bookingClientView9j = () => {
    if (document.querySelector('.exact-bookings-page')) return;
    const pageTitle = Array.from(document.querySelectorAll('h1,h2')).find(x => (x.textContent || '').trim().toLowerCase() === 'bookings');
    if (!pageTitle) return;

    const panels = Array.from(document.querySelectorAll('main .panel-card, main .spotlight-card, main .card, .split > div'));
    const detailPanel = panels.find(panel => /JC-\d+/i.test(panel.textContent || '') && /Customer/i.test(panel.textContent || '') && /Vehicle/i.test(panel.textContent || ''));

    if (!detailPanel) return;

    detailPanel.classList.add('booking-client-detail-panel');

    const text = detailPanel.textContent || '';
    const refMatch = text.match(/JC-\d+/i);
    const ref = refMatch ? refMatch[0] : '';

    const phoneMatch = text.match(/\+\d{10,15}/);
    const phone = phoneMatch ? phoneMatch[0] : '';

    // Make New badge presentation-safe, not permanent.
    Array.from(detailPanel.querySelectorAll('span,b,em,small,button,div')).forEach(el => {
      const t = (el.textContent || '').trim().toLowerCase();
      if (t === 'new') {
        el.classList.add('booking-status-dynamic');
        el.textContent = 'Pending';
      }
    });

    if (detailPanel.querySelector('.booking-client-extra')) return;

    const pin = localStorage.getItem('adminPin') || localStorage.getItem('pin') || localStorage.getItem('studioPin') || '';

    const extra = document.createElement('div');
    extra.className = 'booking-client-extra';
    extra.innerHTML = `
      <div class="booking-media-grid">
        <section>
          <h3>Customer Photos</h3>
          <div class="booking-photo-grid booking-photo-loading">
            <div>No photos uploaded yet</div>
          </div>
        </section>

        <section>
          <h3>Customer Documents</h3>
          <div class="booking-doc-list booking-doc-loading">
            <div>No documents uploaded yet</div>
          </div>
        </section>
      </div>

      <section class="booking-client-notes">
        <h3>Customer Notes</h3>
        <p>Customer details captured from the WhatsApp booking flow. Add uploads and documents during the conversation and they will appear here.</p>
      </section>

      <div class="booking-proceed-row">
        <button class="booking-proceed-btn" type="button">Proceed / Start Job</button>
        <span>This changes the booking from pending to in progress.</span>
      </div>
    `;

    detailPanel.appendChild(extra);

    const photosBox = extra.querySelector('.booking-photo-grid');
    const docsBox = extra.querySelector('.booking-doc-list');

    async function loadDocs() {
      try {
        const res = await fetch(`/api/studio/v3/documents`, {
          headers: { 'x-admin-pin': pin },
          cache: 'no-store'
        });

        const json = await res.json();
        const allDocs = json.documents || [];

        const matching = allDocs.filter(doc => {
          const docRef = String(doc.ref || doc.jobNo || doc.claimNo || '');
          const docPhone = String(doc.customerPhone || '');
          return (ref && docRef === ref) || (phone && docPhone === phone);
        });

        const photos = matching.filter(doc => {
          const u = String(doc.url || doc.filename || '').toLowerCase();
          const m = String(doc.mimeType || doc.mime_type || '').toLowerCase();
          return m.includes('image') || /\.(jpg|jpeg|png|webp|heic)$/i.test(u);
        });

        const files = matching.filter(doc => !photos.includes(doc));

        photosBox.innerHTML = photos.length ? photos.slice(0, 6).map((doc, i) => `
          <a class="booking-photo-card" href="${vpEscapeHtml(vpSafeDashboardMediaUrl(doc.url))}" target="_blank" rel="noreferrer">
            <img src="${vpEscapeHtml(vpSafeDashboardMediaUrl(doc.url))}" alt="Customer upload ${i + 1}" />
            <b>${i === 0 ? '' : i === 1 ? '' : ''}</b>
          </a>
        `).join('') : `<div class="booking-empty-media">No photos uploaded yet</div>`;

        docsBox.innerHTML = files.length ? files.slice(0, 8).map(doc => {
          const url = doc.url || '#';
          const name = doc.filename || 'customer-document';
          const lower = name.toLowerCase();
          const tag = lower.endsWith('.pdf') ? 'PDF' : lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') ? 'IMG' : 'FILE';

          return `
            <a class="booking-doc-row" href="${vpEscapeHtml(vpSafeDashboardMediaUrl(url))}" target="_blank" rel="noreferrer">
              <span>${tag === 'PDF' ? 'PDF' : 'IMG'}</span>
              <b>${vpEscapeHtml(name)}</b>
              <em>${tag}</em>
              <i>⇩</i>
            </a>
          `;
        }).join('') : `<div class="booking-empty-media">No documents uploaded yet</div>`;
      } catch {
        photosBox.innerHTML = `<div class="booking-empty-media">No photos uploaded yet</div>`;
        docsBox.innerHTML = `<div class="booking-empty-media">No documents uploaded yet</div>`;
      }
    }

    loadDocs();

    extra.querySelector('.booking-proceed-btn')?.addEventListener('click', async () => {
      if (!ref) return;

      const btn = extra.querySelector('.booking-proceed-btn');
      btn.disabled = true;
      btn.textContent = 'Processing...';

      try {
        await fetch(`/api/studio/v3/jobs/${encodeURIComponent(ref)}/workflow`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-pin': pin
          },
          body: JSON.stringify({ action: 'in_progress' })
        });

        Array.from(detailPanel.querySelectorAll('.booking-status-dynamic')).forEach(el => {
          el.textContent = 'In Progress';
        });

        btn.textContent = 'In Progress';
      } catch {
        btn.textContent = 'Try Again';
        btn.disabled = false;
      }
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bookingClientView9j);
  } else {
    bookingClientView9j();
  }

  setInterval(bookingClientView9j, 700);
}


// PHASE_9I_FORCE_HIDE_TASKS_DOCUMENTS
if (typeof window !== 'undefined') {
  const forceHideTasksDocuments9i = () => {
    const banned = new Set(['tasks', 'documents']);

    document
      .querySelectorAll('aside a, aside button, .sidebar a, .sidebar button, .side a, .side button, .app-sidebar a, .app-sidebar button')
      .forEach(el => {
        const text = String(el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (banned.has(text)) {
          el.style.display = 'none';
          el.setAttribute('aria-hidden', 'true');
        }
      });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', forceHideTasksDocuments9i);
  } else {
    forceHideTasksDocuments9i();
  }

  setInterval(forceHideTasksDocuments9i, 300);
}


// PHASE_9F_FORCE_HIDE_REMOVED_TABS
if (typeof window !== 'undefined') {
  const forceHideRemovedTabs9f = () => {
    const banned = new Set(['schedule', 'pipeline', 'reports']);

    document
      .querySelectorAll('aside a, aside button, .sidebar a, .sidebar button, .side a, .side button, .app-sidebar a, .app-sidebar button')
      .forEach(el => {
        const text = String(el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (banned.has(text)) {
          el.style.display = 'none';
          el.setAttribute('aria-hidden', 'true');
        }
      });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', forceHideRemovedTabs9f);
  } else {
    forceHideRemovedTabs9f();
  }

  setInterval(forceHideRemovedTabs9f, 300);
}


// PHASE_8H_FORCE_HIDE_REMOVED_TABS
if (typeof window !== 'undefined') {
  const forceHideRemovedTabs = () => {
    const banned = new Set(['team', 'parts', 'payments']);

    document
      .querySelectorAll('aside a, aside button, .sidebar a, .sidebar button, .side a, .side button, .app-sidebar a, .app-sidebar button')
      .forEach(el => {
        const text = String(el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (banned.has(text)) {
          el.style.display = 'none';
          el.setAttribute('aria-hidden', 'true');
        }
      });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', forceHideRemovedTabs);
  } else {
    forceHideRemovedTabs();
  }

  setInterval(forceHideRemovedTabs, 300);
}


// PHASE_8G_HIDE_REMOVED_NAV_TABS
if (typeof window !== 'undefined') {
  const hideRemovedNavTabs = () => {
    const banned = new Set(['team', 'parts', 'payments']);
    document.querySelectorAll('aside button, aside a, .sidebar button, .sidebar a, .side button, .side a, .app-sidebar button, .app-sidebar a').forEach(el => {
      const txt = String(el.textContent || '').trim().toLowerCase();
      if (banned.has(txt)) el.style.display = 'none';
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hideRemovedNavTabs);
  } else {
    hideRemovedNavTabs();
  }

  new MutationObserver(hideRemovedNavTabs).observe(document.documentElement, { childList: true, subtree: true });
}


// PHASE_8F_UX_RUNTIME_ENHANCER
// Customer-ready UX improvements without risky React rewrites.
if (typeof window !== 'undefined') {
  const installUxEnhancer = () => {
    if (window.__phase8fUxInstalled) return;
    window.__phase8fUxInstalled = true;

    function ensureToastHost() {
      let host = document.querySelector('.ux-toast-host');
      if (!host) {
        host = document.createElement('div');
        host.className = 'ux-toast-host';
        document.body.appendChild(host);
      }
      return host;
    }

    window.__uxToast = function(message, type = 'info') {
      const host = ensureToastHost();
      const toast = document.createElement('div');
      toast.className = `ux-toast ux-toast-${type}`;
      toast.textContent = String(message || 'Done');
      host.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('show'));
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 260);
      }, 2600);
    };

    const nativeAlert = window.alert?.bind(window);
    const nativeConfirm = window.confirm?.bind(window);

    window.alert = function(message) {
      window.__uxToast(message || 'Done', 'info');
    };

    window.confirm = function(message) {
      if (!nativeConfirm) return false;
      return nativeConfirm(
        String(message || 'Confirm this action?')
      );
    };

    function labelStatusPills() {
      document.querySelectorAll('.badge, [class*="badge"], [class*="pill"]').forEach(el => {
        const t = (el.textContent || '').trim().toLowerCase();
        el.classList.remove(
          'ux-status-new','ux-status-vip','ux-status-urgent','ux-status-quote',
          'ux-status-paid','ux-status-done','ux-status-waiting','ux-status-normal'
        );

        if (t.includes('vip')) el.classList.add('ux-status-vip');
        else if (t.includes('urgent')) el.classList.add('ux-status-urgent');
        else if (t.includes('quote')) el.classList.add('ux-status-quote');
        else if (t.includes('paid')) el.classList.add('ux-status-paid');
        else if (t.includes('done') || t.includes('complete') || t.includes('closed')) el.classList.add('ux-status-done');
        else if (t.includes('waiting')) el.classList.add('ux-status-waiting');
        else if (t.includes('new')) el.classList.add('ux-status-new');
        else if (t.includes('normal')) el.classList.add('ux-status-normal');
      });
    }

    function addKpiContext() {
      // Real operational metrics only. Synthetic percentage/trend badges were removed.
    }

    function improveEmptyStates() {
      document.querySelectorAll('.empty-state, .note-empty, .pipeline-empty').forEach(el => {
        if (!el.querySelector('.ux-empty-dot')) {
          const dot = document.createElement('div');
          dot.className = 'ux-empty-dot';
          dot.textContent = '•';
          el.prepend(dot);
        }
      });
    }

    function enhanceUx() {
      labelStatusPills();
      addKpiContext();
      improveEmptyStates();
    }

    enhanceUx();

    const obs = new MutationObserver(() => {
      clearTimeout(window.__uxEnhanceTimer);
      window.__uxEnhanceTimer = setTimeout(enhanceUx, 80);
    });

    obs.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installUxEnhancer);
  } else {
    installUxEnhancer();
  }
}


localStorage.removeItem('studioTheme');

const W_LOGO = '/studio/studio-assets/windscreen-logo-clean.png?v=6c';
const V_LOGO = '/studio/studio-assets/visionco-logo.png?v=6c';

const TABS = [['dashboard', 'Dashboard', LayoutDashboard],
  ['activity', 'Activity', ShieldCheck],
  ['bookings', 'Bookings', CalendarCheck],
  ['external-job-cards', 'External Job Cards', ClipboardList],
  ['claims', 'Insurance Claims', ShieldCheck],
  ['jobs', 'Jobs', BriefcaseBusiness],
  ['quotes', 'Quotations', FileText],
  ['parts', 'Stock Catalogue', ClipboardList],
  ['customers', 'Customers', Users],
  ['wifi', 'WiFi Vouchers', Wifi],
  ['settings', 'Settings', SettingsIcon]
];

function cx(...v) {
  return v.filter(Boolean).join(' ');
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

function MadeBy() { return null; }



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
  const [systemOnline, setSystemOnline] = useState(null);
  const healthFailureCount = useRef(0);
  const activeLabel = TABS.find(([key]) => key === active)?.[1] || 'Dashboard';

  const navGroups = [
    { label: 'Overview', keys: ['dashboard'] },
    { label: 'Operations', keys: ['bookings', 'external-job-cards', 'claims', 'jobs'] },
    { label: 'Sales & Stock', keys: ['quotes', 'parts', 'customers'] },
    { label: 'Management', keys: ['activity'] },
    { label: 'System', keys: ['wifi', 'settings'] }
  ];

  useEffect(() => {
    let alive = true;
    async function checkHealth() {
      try {
        const res = await fetch('/health', { cache: 'no-store' });
        if (!res.ok) throw new Error(`Health check failed: HTTP ${res.status}`);
        const json = await res.json();
        const healthy = Boolean(json?.ok && json?.ycloudConfigured);

        if (!alive) return;

        if (healthy) {
          healthFailureCount.current = 0;
          setSystemOnline(true);
          return;
        }

        healthFailureCount.current += 1;
        if (healthFailureCount.current >= 3) setSystemOnline(false);
      } catch {
        if (!alive) return;
        healthFailureCount.current += 1;
        if (healthFailureCount.current >= 3) setSystemOnline(false);
      }
    }
    checkHealth();
    const timer = setInterval(checkHealth, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  function openTab(key) {
    setActive(key);
    setMobileMenuOpen(false);
  }

  return (
    <div className="shell vp-admin-shell">
      <aside className={cx('vp-sidebar', 'sidebar', mobileMenuOpen && 'open')}>
        <header className="brand vp-sidebar-brand">
          <SafeLogo src={W_LOGO} className="logo vp-sidebar-logo" fallback="WF" />
          <div className="brand-copy">
            <div className="brand-title">Windscreen</div>
            <div className="brand-subtitle">Fitment Centre</div>
          </div>
          <button type="button" className="vp-sidebar-close" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </header>

        <div className="profile-wrap">
          <div className="profile vp-admin-profile">
            <div className="avatar">WF</div>
            <div>
              <div className="profile-name">Administrator</div>
              <div className="profile-role">Workshop Operations</div>
            </div>
          </div>
        </div>

        <div className="nav-shell">
          <nav className="nav-scroll vp-sidebar-nav">
            {navGroups.map(group => (
              <section className="group vp-nav-group" key={group.label}>
                <h2 className="section-label vp-nav-label">{group.label.toUpperCase()}</h2>
                {group.keys.map(key => {
                  const tab = TABS.find(([tabKey]) => tabKey === key);
                  if (!tab) return null;
                  const [, label, Icon] = tab;
                  return (
                    <button type="button" key={key} className={cx('nav-item', active === key && 'active')} onClick={() => openTab(key)}>
                      <span className="icon-tile vp-nav-icon"><Icon size={19} strokeWidth={1.8} /></span>
                      <span>{label}</span>
                      {active === key ? <span className="chev">›</span> : <span />}
                    </button>
                  );
                })}
              </section>
            ))}
          </nav>
        </div>

        <footer className="footer vp-sidebar-footer">
          <div className={cx('status', 'vp-sidebar-health', systemOnline === false && 'offline')}>
            <div className="status-ring"><span className="status-dot" /></div>
            <div>
              <div className="status-title">{systemOnline === null ? 'Checking system' : systemOnline ? 'System online' : 'Needs attention'}</div>
              <div className="status-subtitle">WhatsApp automation</div>
            </div>
          </div>
          <button type="button" className="signout vp-signout" onClick={logout}><LogOut size={19} strokeWidth={1.8} /><span>Sign out</span></button>
        </footer>
      </aside>

      {mobileMenuOpen && <button className="vp-sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)} />}

      <section className="vp-main-area">
        {!['dashboard', 'bookings'].includes(active) ? (
          <header className="vp-topbar">
            <button type="button" className="vp-mobile-menu" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu"><Menu size={19} /></button>
            <div className="vp-topbar-title">
              <span>Workshop Operations</span>
              <strong>{activeLabel}</strong>
            </div>
            <div className="vp-topbar-actions">
              <div className={cx('vp-top-health', systemOnline === false && 'offline')}><i /><span>{systemOnline === null ? 'Checking' : systemOnline ? 'Automation online' : 'Automation offline'}</span></div>
              <button type="button" className="vp-top-avatar" onClick={() => openTab('settings')} title="Settings">WF</button>
            </div>
          </header>
        ) : (
          <button type="button" className="vp-dashboard-mobile-menu" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu"><Menu size={19} /></button>
        )}
        <div className="vp-page-slot">{children}</div>
      </section>
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

function FormModal({ title, fields, onClose, onSubmit, initialValues = {} }) {
  const [form, setForm] = useState(initialValues || {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function setValue(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err.message || 'Could not save record.');
    } finally {
      setBusy(false);
    }
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
              ) : f.type === 'select' ? (
                <select value={form[f.key] || ''} onChange={e => setValue(f.key, e.target.value)} required={f.required}>
                  <option value="">Select...</option>
                  {f.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : (
                <input type={f.inputType || 'text'} value={form[f.key] || ''} onChange={e => setValue(f.key, e.target.value)} placeholder={f.placeholder || ''} required={f.required} />
              )}
            </label>
          ))}
        </div>

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

// VP_DIRECT_QUOTATION_MODAL_V1
function QuoteCustomerModal({ job, api, onClose, onSent }) {
  const storedUnitPrice = job?.data?.quoteUnitPrice ?? job?.quoteUnitPrice ?? '';
  const [unitPrice, setUnitPrice] = useState(String(storedUnitPrice || ''));
  const [quantity, setQuantity] = useState(String(job?.data?.quoteQuantity || 1));
  const [taxRate, setTaxRate] = useState(String(job?.data?.quoteTaxRate ?? 15.5));
  const [currency] = useState('USD');
  const [notes, setNotes] = useState(job?.quoteNotes || job?.data?.quoteNotes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [smart, setSmart] = useState(null);
  const [smartLoading, setSmartLoading] = useState(true);
  const [selectedPart, setSelectedPart] = useState(null);

  function money(value) {
    const n = Number(value || 0);
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function usePart(part) {
    if (!part) return;
    setSelectedPart(part);
    if (Number(part.sellingPrice || 0) > 0) setUnitPrice(String(Number(part.sellingPrice || 0)));
    if (!notes.trim() && (part.fitmentDescription || part.name)) setNotes(part.fitmentDescription || part.name);
  }

  useEffect(() => {
    let live = true;
    if (!job?.jobNo) return undefined;
    setSmartLoading(true);
    Promise.all([
      api(`/jobs/${encodeURIComponent(job.jobNo)}/quotations`).catch(() => ({ quotations: [] })),
      api(`/jobs/${encodeURIComponent(job.jobNo)}/smart-quote`).catch(err => ({ match: { status: 'manual_required', reason: err.message || 'Could not run stock match.', candidates: [] } }))
    ]).then(([quoteResult, smartResult]) => {
      if (!live) return;
      setHistory(quoteResult.quotations || []);
      const match = smartResult.match || null;
      setSmart(match);
      if (match?.status === 'exact_match' && match?.recommended) {
        setSelectedPart(match.recommended);
        if (!String(storedUnitPrice || '').trim() && Number(match.recommended.sellingPrice || 0) > 0) {
          setUnitPrice(String(Number(match.recommended.sellingPrice || 0)));
        }
        if (!String(job?.quoteNotes || job?.data?.quoteNotes || '').trim() && match.recommended.fitmentDescription) {
          setNotes(match.recommended.fitmentDescription);
        }
      }
      setSmartLoading(false);
    });
    return () => { live = false; };
  }, [job?.jobNo]);

  const numericQty = Number(quantity || 0);
  const numericUnitPrice = Number(unitPrice || 0);
  const numericTaxRate = Number(taxRate || 0);
  const subtotal = money(numericQty * numericUnitPrice);
  const taxAmount = money(subtotal * numericTaxRate / 100);
  const grandTotal = money(subtotal + taxAmount);
  const previousSent = history.some(x => x.status === 'sent');
  const heading = previousSent ? 'REVISED QUOTATION' : 'QUOTATION';
  const productLine = selectedPart
    ? `Product: ${selectedPart.name || '-'}${selectedPart.sku ? `\nProduct Code: ${selectedPart.sku}` : ''}\n`
    : '';
  const preview = `${heading} - ${job?.jobNo || '-'}\n\nVehicle: ${job?.vehicle || '-'}\n${job?.registration ? `Registration: ${job.registration}\n` : ''}Service: ${job?.service || '-'}\n${productLine}Quantity: ${Number.isFinite(numericQty) ? numericQty : 0}\nUnit Price: ${currency} ${Number.isFinite(numericUnitPrice) ? numericUnitPrice.toFixed(2) : '0.00'}\nSubtotal: ${currency} ${subtotal.toFixed(2)}\nVAT ${Number.isFinite(numericTaxRate) ? numericTaxRate.toFixed(2) : '0.00'}%: ${currency} ${taxAmount.toFixed(2)}\nGRAND TOTAL: ${currency} ${grandTotal.toFixed(2)}${notes.trim() ? `\n\n${notes.trim()}` : ''}\n\nThe customer receives Approve / Ask Question / Decline buttons plus the branded PDF quotation.`;

  const smartLabel = {
    exact_match: 'Exact Match',
    needs_selection: 'Needs Selection',
    review_required: 'Review Required',
    out_of_stock: 'Out of Stock',
    manual_required: 'Manual Quote Required'
  }[smart?.status] || 'Checking Stock';

  const smartClass = smart?.status === 'exact_match'
    ? 'good'
    : smart?.status === 'out_of_stock' || smart?.status === 'manual_required'
      ? 'bad'
      : 'warn';

  async function submit(e) {
    e.preventDefault();
    if (!Number.isInteger(numericQty) || numericQty < 1) {
      setError('Enter a valid whole-number quantity.');
      return;
    }
    if (!numericUnitPrice || numericUnitPrice <= 0) {
      setError('Enter a valid unit price before VAT.');
      return;
    }
    if (!Number.isFinite(numericTaxRate) || numericTaxRate < 0 || numericTaxRate > 100) {
      setError('Enter a valid VAT / tax percentage.');
      return;
    }
    if (selectedPart && Number(selectedPart.quantity || 0) < numericQty) {
      setError(`Not enough stock. Available: ${Number(selectedPart.quantity || 0)}`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const result = await api(`/jobs/${encodeURIComponent(job.jobNo)}/quotation`, 'POST', {
        amount: grandTotal,
        quantity: numericQty,
        unitPrice: numericUnitPrice,
        taxRate: numericTaxRate,
        currency,
        notes: notes.trim(),
        requestId,
        partId: selectedPart?.id || null,
        matchStatus: selectedPart
          ? (smart?.status === 'exact_match' && selectedPart.id === smart?.recommended?.id ? 'exact_match_reviewed' : 'staff_selected')
          : 'manual'
      });
      await onSent?.(result);
    } catch (err) {
      setError(err.message || 'Could not send quotation.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop vp-quote-modal-backdrop">
      <form className="modal-card vp-quote-modal vp-smart-quote-modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <span>Smart Stock + Branded PDF Quotation</span>
            <h2>Review & Send - {job?.jobNo}</h2>
          </div>
          <button type="button" onClick={onClose}>×</button>
        </div>

        <div className="vp-quote-customer-grid">
          <div><span>Customer</span><strong>{job?.customerName || '-'}</strong></div>
          <div><span>WhatsApp</span><strong>{job?.customerPhone || '-'}</strong></div>
          <div><span>Vehicle</span><strong>{job?.vehicle || '-'}</strong></div>
          <div><span>Service</span><strong>{job?.service || '-'}</strong></div>
        </div>

        <section className={`vp-smart-match-box ${smartClass}`}>
          <div className="vp-smart-match-head">
            <div>
              <span>Smart stock result</span>
              <strong>{smartLoading ? 'Searching stock catalogue…' : smartLabel}</strong>
            </div>
            {!smartLoading && <Badge>{smartLabel}</Badge>}
          </div>
          {!smartLoading && <p>{smart?.reason || 'No stock result available.'}</p>}
          {!smartLoading && smart?.detectedYear && <small>Detected vehicle year: {smart.detectedYear}</small>}

          {!smartLoading && (smart?.candidates || []).length > 0 && (
            <div className="vp-smart-candidates">
              {(smart.candidates || []).map(part => {
                const chosen = selectedPart?.id === part.id;
                const out = Number(part.quantity || 0) <= 0;
                return (
                  <button key={part.id} type="button" className={chosen ? 'selected' : ''} onClick={() => !out && usePart(part)} disabled={out}>
                    <div>
                      <strong>{part.name}</strong>
                      <span>{part.sku || 'No product code'} • {part.vehicleMake} {part.vehicleModel} {part.yearFrom ? `${part.yearFrom}${part.yearTo && part.yearTo !== part.yearFrom ? `–${part.yearTo}` : ''}` : ''}</span>
                    </div>
                    <div>
                      <b>USD {Number(part.sellingPrice || 0).toFixed(2)}</b>
                      <small>{out ? 'Out of stock' : `${Number(part.quantity || 0)} in stock • price before VAT`}</small>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {!smartLoading && (
            <div className="vp-smart-match-actions">
              <button type="button" onClick={() => { setSelectedPart(null); if (!storedUnitPrice) setUnitPrice(''); }}>Use Manual Quote</button>
              <button type="button" onClick={() => {
                setSmartLoading(true);
                api(`/jobs/${encodeURIComponent(job.jobNo)}/smart-quote`)
                  .then(r => { setSmart(r.match || null); setSmartLoading(false); })
                  .catch(err => { setError(err.message); setSmartLoading(false); });
              }}>Re-run Stock Match</button>
            </div>
          )}
        </section>

        {selectedPart && (
          <div className="vp-selected-stock">
            <strong>Selected Stock Item</strong>
            <span>{selectedPart.name}</span>
            <small>{selectedPart.sku || 'No SKU'} • Stock {Number(selectedPart.quantity || 0)} • Unit Price before VAT USD {Number(selectedPart.sellingPrice || 0).toFixed(2)}</small>
            <em>Stock is not deducted when the quotation is sent. The quoted quantity is committed only after the customer taps Approve.</em>
          </div>
        )}

        <div className="modal-grid vp-quote-fields vp-quote-tax-fields">
          <label>
            Currency
            <select value={currency} disabled><option value="USD">USD</option></select>
          </label>
          <label>
            Quantity
            <input inputMode="numeric" type="number" min="1" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} required />
          </label>
          <label>
            Unit Price before VAT
            <input inputMode="decimal" type="number" min="0.01" step="0.01" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} placeholder="121.20" required />
          </label>
          <label>
            VAT / Tax Rate %
            <input inputMode="decimal" type="number" min="0" max="100" step="0.01" value={taxRate} onChange={e => setTaxRate(e.target.value)} placeholder="15.50" required />
          </label>
          <label className="large">
            Quotation details / notes
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Example: Front windscreen including fitting. Quote valid for 7 days." />
          </label>
        </div>

        <div className="vp-quote-financial-summary">
          <div><span>SUB TOTAL</span><strong>USD {subtotal.toFixed(2)}</strong></div>
          <div><span>TAX ({Number.isFinite(numericTaxRate) ? numericTaxRate.toFixed(2) : '0.00'}%)</span><strong>USD {taxAmount.toFixed(2)}</strong></div>
          <div className="grand"><span>GRAND TOTAL</span><strong>USD {grandTotal.toFixed(2)}</strong></div>
        </div>

        <div className="vp-quote-preview">
          <div className="vp-quote-preview-head">
            <strong>WhatsApp + PDF preview</strong>
            <span>The PDF includes the business logo, address, contacts, TIN/VAT, item table, totals, payment instructions and authorized-signature area.</span>
          </div>
          <pre>{preview}</pre>
        </div>

        {history.length > 0 && (
          <div className="vp-quote-history">
            <strong>Previous quotations</strong>
            {history.slice(0, 8).map(q => (
              <div key={q.id || q.quoteNo}>
                <span>{q.quoteNo}{q.partName ? ` • ${q.partName}` : ''}</span>
                <b>{q.currency} {Number(q.grandTotal ?? q.amount ?? 0).toFixed(2)}</b>
                <small>{q.status === 'sent' ? 'Sent' : q.status}{Number(q.taxRate || 0) > 0 ? ` • VAT ${Number(q.taxRate).toFixed(2)}%` : ''} {q.sentAt ? `• ${new Date(q.sentAt).toLocaleString()}` : ''}{q.stockCommittedAt ? ' • Stock committed' : ''}</small>
                {q.pdfUrl && <a href={q.pdfUrl} target="_blank" rel="noreferrer">Open PDF</a>}
              </div>
            ))}
          </div>
        )}

        {error && <div className="modal-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" type="submit" disabled={busy || smartLoading || !Number.isInteger(numericQty) || numericQty < 1 || !numericUnitPrice || numericUnitPrice <= 0}>
            {busy ? 'Generating PDF & Sending…' : previousSent ? 'Review & Send Revised Quotation' : 'Review & Send Quotation'}
          </button>
        </div>
      </form>
    </div>
  );
}


function QuotationHistoryPanel({ jobNo, api, refreshTick = 0 }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    if (!jobNo) {
      setRows([]);
      setError('');
      return undefined;
    }

    setLoading(true);
    setError('');
    api(`/jobs/${encodeURIComponent(jobNo)}/quotations`)
      .then(result => {
        if (!live) return;
        setRows(result?.quotations || []);
      })
      .catch(err => {
        if (!live) return;
        setRows([]);
        setError(err?.message || 'Could not load quotation history.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => { live = false; };
  }, [jobNo, refreshTick]);

  return (
    <div className="vp-quote-history vp-quote-register-history">
      <strong>Quotation history</strong>
      {loading ? (
        <small>Loading quotation history…</small>
      ) : error ? (
        <small>{error}</small>
      ) : rows.length === 0 ? (
        <small>No generated quotation has been recorded for this job yet.</small>
      ) : (
        rows.slice(0, 12).map(q => (
          <div key={q.id || q.quoteNo}>
            <span>{q.quoteNo}{q.partName ? ` • ${q.partName}` : ''}</span>
            <b>{q.currency || 'USD'} {Number(q.grandTotal ?? q.amount ?? 0).toFixed(2)}</b>
            <small>
              {q.status === 'sent' ? 'Sent to customer' : q.status}
              {Number(q.taxRate || 0) > 0 ? ` • VAT ${Number(q.taxRate).toFixed(2)}%` : ''}
              {q.sentAt ? ` • ${new Date(q.sentAt).toLocaleString()}` : ''}
              {q.stockCommittedAt ? ' • Stock committed' : ''}
            </small>
            {q.pdfUrl && <a href={q.pdfUrl} target="_blank" rel="noreferrer">Open quotation PDF</a>}
          </div>
        ))
      )}
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

const SERVICE_OPTIONS = [
  'Windscreen Replacement',
  'Windscreen Repair',
  'Side / Door Glass',
  'Rear Glass',
  'Ceramic Tint',
  'Anti-smash and Grab Film',
  'Alarms',
  'Aircon',
  'Trackers',
  'Car Audio'
];

const PRIORITY_OPTIONS = [
  'Normal',
  'Urgent',
  'Insurance',
  'Waiting Parts',
  'VIP'
];

const JOB_FIELDS = [
  { key: 'customerPhone', label: 'Phone number', placeholder: '+263...', required: true },
  { key: 'customerName', label: 'Customer name' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'registration', label: 'Registration' },
  { key: 'service', label: 'Service', type: 'select', options: SERVICE_OPTIONS, required: true },
  { key: 'location', label: 'Location' },
  { key: 'bookingDate', label: 'Booking Date', inputType: 'date' },
  { key: 'bookingTime', label: 'Booking Time', inputType: 'time' },
  { key: 'priority', label: 'Priority', type: 'select', options: PRIORITY_OPTIONS },
  { key: 'fitter', label: 'Fitter / Technician' },
  { key: 'notes', label: 'Notes', type: 'textarea', large: true }
];


function NotesTimeline({ api, refNo, refreshKey = 0 }) {
  const [notes, setNotes] = useState([]);

  useEffect(() => {
    let alive = true;

    async function loadNotes() {
      if (!refNo) {
        setNotes([]);
        return;
      }

      try {
        const result = await api(`/notes?ref=${encodeURIComponent(refNo)}`);
        if (alive) setNotes(result.notes || []);
      } catch {
        if (alive) setNotes([]);
      }
    }

    loadNotes();
    return () => { alive = false; };
  }, [api, refNo, refreshKey]);

  return (
    <div className="notes-timeline">
      <h3>Internal Notes</h3>

      {!notes.length ? (
        <div className="note-empty">No internal notes yet.</div>
      ) : (
        <div className="note-list">
          {notes.map(n => (
            <div className="note-item" key={n.id}>
              <div>
                <strong>{n.type || 'note'}</strong>
                <span>{n.actor || 'studio'} • {n.createdAt || ''}</span>
              </div>
              <p>{n.note}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function matchesSearch(row, q) {
  if (!q) return true;
  const text = JSON.stringify(row || {}).toLowerCase();
  return text.includes(String(q).toLowerCase());
}

function matchesStatus(row, status) {
  if (!status || status === 'all') return true;
  const text = `${row?.publicStatus || ''} ${row?.status || ''} ${row?.jobType || ''} ${row?.type || ''}`.toLowerCase();
  return text.includes(String(status).toLowerCase());
}

function FilterBar({ search, setSearch, status, setStatus, count, label = 'records' }) {
  return (
    <div className="filter-bar">
      <div className="filter-search">
        <span>Search</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, phone, vehicle, ref..." />
      </div>

      <div className="filter-status">
        <span>Status</span>
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">All</option>
          <option value="new">New</option>
          <option value="booked">Booked</option>
          <option value="quote">Quote</option>
          <option value="assigned">Assigned</option>
          <option value="progress">In progress</option>
          <option value="completed">Completed</option>
          <option value="paid">Paid</option>
          <option value="review">Review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <strong>{count} {label}</strong>
    </div>
  );
}

function CustomerFilterBar({ search, setSearch, count }) {
  return (
    <div className="filter-bar customer-filter">
      <div className="filter-search">
        <span>Search</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, phone, vehicle, registration..." />
      </div>
      <strong>{count} customers</strong>
    </div>
  );
}


function csvEscape(value) {
  let text = String(value ?? '');
  // Prevent spreadsheet formula injection when exported customer-controlled data
  // is opened in Excel/Sheets.
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCSV(filename, rows) {
  if (!rows?.length) {
    alert('No records to export.');
    return;
  }

  const flatRows = rows.map(row => ({
    ref: row.ref || row.claimNo || row.jobNo || '',
    customer: row.customerName || row.name || '',
    phone: row.customerPhone || row.phone || '',
    vehicle: row.vehicle || '',
    registration: row.registration || row.reg || '',
    service: row.service || '',
    status: row.publicStatus || row.status || '',
    updatedAt: row.updatedAt || row.createdAt || ''
  }));

  const headers = Object.keys(flatRows[0]);
  const csv = [
    headers.map(csvEscape).join(','),
    ...flatRows.map(row => headers.map(h => csvEscape(row[h])).join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function printCard(title, rows) {
  const content = rows.map(([k, v]) => `
    <tr>
      <th>${vpEscapeHtml(k)}</th>
      <td>${vpEscapeHtml(v ?? '-')}</td>
    </tr>
  `).join('');

  const html = `
    <!doctype html>
    <html>
      <head>
        <title>${vpEscapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 34px; color: #101828; }
          .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #1268ff; padding-bottom:18px; margin-bottom:24px; }
          h1 { margin:0; font-size:30px; }
          p { margin:6px 0 0; color:#667085; }
          table { width:100%; border-collapse:collapse; margin-top:12px; }
          th, td { border:1px solid #d0d5dd; padding:12px; text-align:left; vertical-align:top; }
          th { width:34%; background:#f2f4f7; }
          .footer { margin-top:34px; color:#667085; font-size:12px; border-top:1px solid #d0d5dd; padding-top:12px; }
        </style>
      </head>
      <body>
        <div class="head">
          <div>
            <h1>${vpEscapeHtml(title)}</h1>
            <p>Windscreen Automation Dashboard</p>
          </div>
          <p>${new Date().toLocaleString()}</p>
        </div>
        <table>${content}</table>
        <div class="footer">Generated from VisionCo Windscreen Automation Dashboard.</div>
        <script>window.print();</script>
      </body>
    </html>
  `;

  const w = window.open('', '_blank');
  if (!w) {
    alert('Popup blocked. Please allow popups for this dashboard.');
    return;
  }

  w.document.open();
  w.document.write(html);
  w.document.close();
}

function TableTools({ onExport }) {
  return (
    <div className="table-tools">
      <button onClick={onExport}>Export CSV</button>
    </div>
  );
}


function toDateKey(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Harare', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function harareDateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Harare', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function scheduleDate(row) {
  return row?.bookingDate || row?.booking_date || row?.data?.bookingDate || row?.createdAt || row?.updatedAt || '';
}

function scheduleTime(row) {
  return row?.bookingTime || row?.booking_time || row?.data?.bookingTime || '';
}

function schedulePriority(row) {
  return row?.priority || row?.data?.priority || 'Normal';
}

function SchedulePage({ data, setActive }) {
  const [search, setSearch] = useState('');
  const [view, setView] = useState('today');

  const today = todayKey();

  const allRows = [
    ...(data.bookings || []),
    ...(data.jobs || [])
  ].filter((row, index, arr) => {
    const id = row.jobNo || row.ref || `${row.customerPhone}-${row.createdAt}`;
    return arr.findIndex(x => (x.jobNo || x.ref || `${x.customerPhone}-${x.createdAt}`) === id) === index;
  });

  const datedRows = allRows.map(row => ({
    ...row,
    scheduleDateKey: toDateKey(scheduleDate(row)),
    scheduleTimeValue: scheduleTime(row),
    schedulePriorityValue: schedulePriority(row)
  }));

  const filteredRows = datedRows
    .filter(row => matchesSearch(row, search))
    .filter(row => {
      if (view === 'all') return true;
      if (view === 'today') return row.scheduleDateKey === today;
      if (view === 'upcoming') return row.scheduleDateKey && row.scheduleDateKey > today;
      if (view === 'overdue') return row.scheduleDateKey && row.scheduleDateKey < today && !String(row.publicStatus || row.status || '').toLowerCase().includes('completed');
      return true;
    })
    .sort((a, b) => `${a.scheduleDateKey} ${a.scheduleTimeValue}`.localeCompare(`${b.scheduleDateKey} ${b.scheduleTimeValue}`));

  const todayRows = datedRows.filter(r => r.scheduleDateKey === today);
  const upcomingRows = datedRows.filter(r => r.scheduleDateKey && r.scheduleDateKey > today);
  const overdueRows = datedRows.filter(r => r.scheduleDateKey && r.scheduleDateKey < today && !String(r.publicStatus || r.status || '').toLowerCase().includes('completed'));

  function printSchedule() {
    const rows = filteredRows.map(r => [
      r.scheduleDateKey || '-',
      `${r.scheduleTimeValue || '-'} | ${r.customerName || r.customerPhone || '-'}`,
      `${r.vehicle || '-'} | ${r.service || '-'}`,
      `${r.location || '-'} | ${r.schedulePriorityValue || 'Normal'} | ${r.publicStatus || r.status || '-'}`
    ]);

    if (!rows.length) {
      alert('No schedule records to print.');
      return;
    }

    const content = rows.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${vpEscapeHtml(r[0])}</td>
        <td>${vpEscapeHtml(r[1])}</td>
        <td>${vpEscapeHtml(r[2])}</td>
        <td>${vpEscapeHtml(r[3])}</td>
      </tr>
    `).join('');

    const html = `
      <!doctype html>
      <html>
        <head>
          <title>Workshop Schedule</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 34px; color: #101828; }
            h1 { margin:0; font-size:30px; }
            p { margin:6px 0 22px; color:#667085; }
            table { width:100%; border-collapse:collapse; }
            th, td { border:1px solid #d0d5dd; padding:10px; text-align:left; vertical-align:top; font-size:13px; }
            th { background:#f2f4f7; }
            .head { border-bottom:3px solid #1268ff; padding-bottom:18px; margin-bottom:24px; }
          </style>
        </head>
        <body>
          <div class="head">
            <h1>Workshop Schedule</h1>
            <p>View: ${vpEscapeHtml(view)} • Generated ${vpEscapeHtml(new Date().toLocaleString())}</p>
          </div>
          <table>
            <thead>
              <tr><th>#</th><th>Date</th><th>Time / Customer</th><th>Vehicle / Service</th><th>Location / Priority / Status</th></tr>
            </thead>
            <tbody>${content}</tbody>
          </table>
          <script>window.print();</script>
        </body>
      </html>
    `;

    const w = window.open('', '_blank');
    if (!w) {
      alert('Popup blocked. Please allow popups for this dashboard.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  return (
    <Page title="Schedule" sub="Daily workshop plan for bookings, jobs, fitters and priorities.">
      <div className="schedule-summary">
        <SpotlightCard className="schedule-mini-card">
          <span>Today</span>
          <strong>{todayRows.length}</strong>
          <small>{today}</small>
        </SpotlightCard>
        <SpotlightCard className="schedule-mini-card">
          <span>Upcoming</span>
          <strong>{upcomingRows.length}</strong>
          <small>future bookings</small>
        </SpotlightCard>
        <SpotlightCard className="schedule-mini-card urgent">
          <span>Overdue</span>
          <strong>{overdueRows.length}</strong>
          <small>not completed</small>
        </SpotlightCard>
      </div>

      <SpotlightCard className="panel-card">
        <div className="schedule-toolbar">
          <div className="filter-search">
            <span>Search Schedule</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, fitter, vehicle, service..." />
          </div>

          <div className="filter-status">
            <span>View</span>
            <select value={view} onChange={e => setView(e.target.value)}>
              <option value="today">Today</option>
              <option value="upcoming">Upcoming</option>
              <option value="overdue">Overdue</option>
              <option value="all">All Schedule</option>
            </select>
          </div>

          <strong>{filteredRows.length} records</strong>
        </div>

        <div className="table-tools">
          <button onClick={() => downloadCSV(`schedule-${view}.csv`, filteredRows)}>Export Schedule CSV</button>
          <button onClick={printSchedule}>Print Schedule</button>
        </div>

        {!filteredRows.length ? (
          <EmptyState title="No schedule records found" copy="Create a booking with date and time to see it here." />
        ) : (
          <div className="schedule-list">
            {filteredRows.map(row => (
              <button key={row.jobNo || row.ref} onClick={() => setActive(row.jobType === 'booking' ? 'bookings' : 'jobs')}>
                <div className="schedule-date">
                  <b>{row.scheduleDateKey || 'No date'}</b>
                  <span>{row.scheduleTimeValue || 'No time'}</span>
                </div>

                <div>
                  <strong>{row.customerName || row.customerPhone || '-'}</strong>
                  <small>{row.vehicle || '-'} • {row.registration || '-'}</small>
                </div>

                <div>
                  <strong>{row.service || '-'}</strong>
                  <small>{row.location || '-'} • {row.fitter || row.assignedTo || row.data?.fitter || 'No fitter'}</small>
                </div>

                <div className="schedule-status">
                  <Badge>{row.publicStatus || row.status}</Badge>
                  <em>{row.schedulePriorityValue || 'Normal'}</em>
                </div>
              </button>
            ))}
          </div>
        )}
      </SpotlightCard>

      <MadeBy />
    </Page>
  );
}



function normalStatus(row) {
  return String(row?.status || row?.publicStatus || '').toLowerCase();
}

function pipelineBucket(row) {
  const s = normalStatus(row);
  const t = String(row?.jobType || row?.type || '').toLowerCase();

  if (s.includes('paid') || s.includes('completed') || s.includes('closed')) return 'done';
  if (s.includes('waiting')) return 'waiting';
  if (s.includes('progress')) return 'progress';
  if (s.includes('assigned')) return 'assigned';
  if (s.includes('quoted') || s.includes('quote')) return 'quoted';
  if (t.includes('quote')) return 'quoted';

  return 'new';
}

const PIPELINE_COLUMNS = [
  { key: 'new', title: 'New / Booked', next: 'assigned', nextLabel: 'Assign / Move' },
  { key: 'quoted', title: 'Quoted', next: 'assigned', nextLabel: 'Mark Assigned' },
  { key: 'assigned', title: 'Assigned', next: 'in_progress', nextLabel: 'Start Job' },
  { key: 'progress', title: 'In Progress', next: 'completed', nextLabel: 'Complete' },
  { key: 'waiting', title: 'Waiting Parts', next: 'in_progress', nextLabel: 'Resume' },
  { key: 'done', title: 'Completed / Paid', next: '', nextLabel: '' }
];

function PipelinePage({ data, api, reload }) {
  const [search, setSearch] = useState('');

  const rows = [
    ...(data.bookings || []),
    ...(data.quotes || []),
    ...(data.jobs || [])
  ].filter((row, index, arr) => {
    const id = row.jobNo || row.ref || `${row.customerPhone}-${row.createdAt}`;
    return arr.findIndex(x => (x.jobNo || x.ref || `${x.customerPhone}-${x.createdAt}`) === id) === index;
  }).filter(row => matchesSearch(row, search));

  async function moveJob(row, status) {
    if (!row?.jobNo || !status) return;
    await api(`/jobs/${row.jobNo}/status`, 'POST', { status });
    await api('/notes', 'POST', {
      ref: row.jobNo,
      type: 'pipeline',
      note: `Moved in pipeline to ${status.replaceAll('_', ' ')}.`
    });
    await reload();
  }

  async function quickAssign(row) {
    if (!row?.jobNo) return;

    const fitter = await chooseTeamFitter(api);
    if (!fitter) return;

    await api(`/jobs/${row.jobNo}/workflow`, 'POST', { action: 'assign_fitter', value: fitter });
    await reload();
  }

  return (
    <Page title="Pipeline" sub="Visual workflow board for bookings, quotes and active workshop jobs.">
      <SpotlightCard className="panel-card">
        <div className="pipeline-toolbar">
          <div className="filter-search">
            <span>Search Pipeline</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ref, customer, vehicle, fitter, service..." />
          </div>

          <strong>{rows.length} records</strong>

          <button onClick={() => downloadCSV('pipeline-export.csv', rows)}>Export Pipeline CSV</button>
        </div>

        <div className="pipeline-board">
          {PIPELINE_COLUMNS.map(col => {
            const colRows = rows.filter(row => pipelineBucket(row) === col.key);

            return (
              <div className="pipeline-column" key={col.key}>
                <div className="pipeline-column-head">
                  <h3>{col.title}</h3>
                  <span>{colRows.length}</span>
                </div>

                {!colRows.length ? (
                  <div className="pipeline-empty">No records</div>
                ) : (
                  <div className="pipeline-cards">
                    {colRows.map(row => (
                      <div className="pipeline-card" key={row.jobNo || row.ref}>
                        <div className="pipeline-card-head">
                          <strong>{row.ref || row.jobNo}</strong>
                          <Badge>{row.publicStatus || row.status}</Badge>
                        </div>

                        <h4>{row.customerName || row.customerPhone || '-'}</h4>
                        <p>{row.vehicle || '-'} • {row.registration || '-'}</p>
                        <p>{row.service || '-'}</p>

                        <div className="pipeline-meta">
                          <span>{row.bookingDate || row.data?.bookingDate || 'No date'}</span>
                          <span>{row.fitter || row.assignedTo || row.data?.fitter || 'No fitter'}</span>
                        </div>

                        <div className="pipeline-actions">
                          {col.key !== 'assigned' && col.key !== 'done' && (
                            <button onClick={() => quickAssign(row)}>Assign</button>
                          )}

                          {col.next && (
                            <button className="primary" onClick={() => moveJob(row, col.next)}>{col.nextLabel}</button>
                          )}

                          {col.key !== 'waiting' && col.key !== 'done' && (
                            <button onClick={() => moveJob(row, 'waiting_parts')}>Waiting Parts</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SpotlightCard>

      <MadeBy />
    </Page>
  );
}



function getQuoteValue(row) {
  const raw = row?.quoteAmount || row?.quote_amount || row?.data?.quoteAmount || row?.data?.quote_amount || 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function countBy(rows, getKey) {
  const out = {};
  (rows || []).forEach(row => {
    const key = getKey(row) || 'Unknown';
    out[key] = (out[key] || 0) + 1;
  });
  return Object.entries(out)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function sumBy(rows, getValue) {
  return (rows || []).reduce((total, row) => total + Number(getValue(row) || 0), 0);
}

function ReportBar({ label, value, max }) {
  const pct = max ? Math.max(4, Math.round((value / max) * 100)) : 0;

  return (
    <div className="report-bar-row">
      <div>
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
      <i>
        <b style={{ width: `${pct}%` }}></b>
      </i>
    </div>
  );
}

function ReportsPage({ data }) {
  const bookings = data.bookings || [];
  const quotes = data.quotes || [];
  const claims = data.claims || [];
  const jobs = data.jobs || [];
  const customers = data.customers || [];

  const allWork = [...bookings, ...quotes, ...jobs];
  const services = countBy(allWork, row => row.service || 'Unspecified');
  const statuses = countBy([...allWork, ...claims], row => row.publicStatus || row.status || 'New');

  const maxService = Math.max(1, ...services.map(x => x.count));
  const maxStatus = Math.max(1, ...statuses.map(x => x.count));

  const quoteValue = sumBy(allWork, getQuoteValue);
  const today = todayKey();

  const scheduleRows = allWork.map(row => ({
    ...row,
    scheduleDateKey: String(row.bookingDate || row.booking_date || row.data?.bookingDate || '').slice(0, 10)
  }));

  const todayCount = scheduleRows.filter(r => r.scheduleDateKey === today).length;
  const upcomingCount = scheduleRows.filter(r => r.scheduleDateKey && r.scheduleDateKey > today).length;
  const overdueCount = scheduleRows.filter(r => {
    const done = String(r.publicStatus || r.status || '').toLowerCase().includes('completed');
    return r.scheduleDateKey && r.scheduleDateKey < today && !done;
  }).length;

  const reportRows = [
    { metric: 'Bookings', value: bookings.length },
    { metric: 'Quotes', value: quotes.length },
    { metric: 'Claims', value: claims.length },
    { metric: 'Jobs', value: jobs.length },
    { metric: 'Customers', value: customers.length },
    { metric: 'Today schedule', value: todayCount },
    { metric: 'Upcoming schedule', value: upcomingCount },
    { metric: 'Overdue schedule', value: overdueCount },
    { metric: 'Quote value estimate', value: `$${quoteValue.toFixed(2)}` }
  ];

  function exportReport() {
    const rows = [
      ...reportRows.map(r => ({ ref: r.metric, customer: r.value, phone: '', vehicle: '', registration: '', service: '', status: 'Report', updatedAt: today })),
      ...services.map(r => ({ ref: 'Service', customer: r.name, phone: r.count, vehicle: '', registration: '', service: r.name, status: 'Service Breakdown', updatedAt: today })),
      ...statuses.map(r => ({ ref: 'Status', customer: r.name, phone: r.count, vehicle: '', registration: '', service: '', status: 'Status Breakdown', updatedAt: today }))
    ];
    downloadCSV('dashboard-report.csv', rows);
  }

  function printReport() {
    printCard('Dashboard Report Summary', [
      ['Bookings', bookings.length],
      ['Quotes', quotes.length],
      ['Claims', claims.length],
      ['Jobs', jobs.length],
      ['Customers', customers.length],
      ['Today Schedule', todayCount],
      ['Upcoming Schedule', upcomingCount],
      ['Overdue Schedule', overdueCount],
      ['Quote Value Estimate', `$${quoteValue.toFixed(2)}`],
      ['Top Service', services[0] ? `${services[0].name} (${services[0].count})` : '-'],
      ['Top Status', statuses[0] ? `${statuses[0].name} (${statuses[0].count})` : '-']
    ]);
  }

  return (
    <Page title="Reports" sub="Workshop performance, service demand, status breakdown and schedule insights.">
      <div className="reports-kpi-grid">
        <SpotlightCard className="report-kpi"><span>Bookings</span><strong>{bookings.length}</strong><small>customer bookings</small></SpotlightCard>
        <SpotlightCard className="report-kpi"><span>Quotes</span><strong>{quotes.length}</strong><small>quote requests</small></SpotlightCard>
        <SpotlightCard className="report-kpi"><span>Claims</span><strong>{claims.length}</strong><small>insurance claims</small></SpotlightCard>
        <SpotlightCard className="report-kpi"><span>Jobs</span><strong>{jobs.length}</strong><small>workshop jobs</small></SpotlightCard>
        <SpotlightCard className="report-kpi"><span>Customers</span><strong>{customers.length}</strong><small>customer profiles</small></SpotlightCard>
        <SpotlightCard className="report-kpi money"><span>Quote Value</span><strong>${quoteValue.toFixed(2)}</strong><small>estimated pipeline value</small></SpotlightCard>
      </div>

      <SpotlightCard className="panel-card">
        <div className="reports-head">
          <div>
            <h2>Report Actions</h2>
            <p>Export or print a quick workshop summary.</p>
          </div>
          <div className="table-tools">
            <button onClick={exportReport}>Export Report CSV</button>
            <button onClick={printReport}>Print Report Summary</button>
          </div>
        </div>
      </SpotlightCard>

      <div className="reports-grid">
        <SpotlightCard className="panel-card">
          <SectionHead title="Schedule Overview" />
          <div className="report-schedule-grid">
            <div><strong>{todayCount}</strong><span>Today</span></div>
            <div><strong>{upcomingCount}</strong><span>Upcoming</span></div>
            <div className="danger"><strong>{overdueCount}</strong><span>Overdue</span></div>
          </div>
        </SpotlightCard>

        <SpotlightCard className="panel-card">
          <SectionHead title="Status Breakdown" />
          {!statuses.length ? (
            <EmptyState title="No status data yet" />
          ) : (
            <div className="report-bars">
              {statuses.slice(0, 8).map(row => (
                <ReportBar key={row.name} label={row.name} value={row.count} max={maxStatus} />
              ))}
            </div>
          )}
        </SpotlightCard>
      </div>

      <SpotlightCard className="panel-card">
        <SectionHead title="Service Demand" />
        {!services.length ? (
          <EmptyState title="No service data yet" />
        ) : (
          <div className="report-bars">
            {services.slice(0, 12).map(row => (
              <ReportBar key={row.name} label={row.name} value={row.count} max={maxService} />
            ))}
          </div>
        )}
      </SpotlightCard>

      <MadeBy />
    </Page>
  );
}



function ActivityPage({ api, refreshTick = 0 }) {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  async function loadActivity(silent = false) {
    if (!silent) setLoading(true);
    try {
      const result = await api('/activity?limit=500');
      setRows(result.activity || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadActivity();
  }, []);
  useStudioRefreshPulse(refreshTick, () => loadActivity(true));

  const types = Array.from(new Set(rows.map(r => r.type || 'note'))).sort();

  const filteredRows = rows.filter(row => {
    const textOk = matchesSearch(row, search);
    const typeOk = typeFilter === 'all' || String(row.type || 'note') === typeFilter;
    return textOk && typeOk;
  });

  // VP_ACTIVITY_AUDIT_CONSOLE_V2
  const todayKeyValue = todayKey();
  const todayActivityCount = rows.filter(row => harareDateKey(row.createdAt) === todayKeyValue).length;
  const whatsappActivityCount = rows.filter(row => /whatsapp|message|customer update/i.test(`${row.type || ''} ${row.note || ''}`)).length;
  const workflowActivityCount = rows.filter(row => /job|booking|claim|status|workflow/i.test(`${row.type || ''} ${row.note || ''}`)).length;

  function exportActivity() {
    const exportRows = filteredRows.map(row => ({
      ref: row.ref || '',
      customer: row.type || '',
      phone: row.actor || '',
      vehicle: '',
      registration: '',
      service: row.note || '',
      status: 'Activity',
      updatedAt: row.createdAt || ''
    }));

    downloadCSV('activity-log.csv', exportRows);
  }

  function printActivity() {
    const topRows = filteredRows.slice(0, 80);

    if (!topRows.length) {
      alert('No activity to print.');
      return;
    }

    const content = topRows.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${vpEscapeHtml(r.createdAt || '-')}</td>
        <td>${vpEscapeHtml(r.ref || '-')}</td>
        <td>${vpEscapeHtml(r.type || '-')}</td>
        <td>${vpEscapeHtml(r.actor || '-')}</td>
        <td>${vpEscapeHtml(r.note || '-')}</td>
      </tr>
    `).join('');

    const html = `
      <!doctype html>
      <html>
        <head>
          <title>Activity Log</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 34px; color: #101828; }
            h1 { margin:0; font-size:30px; }
            p { margin:6px 0 22px; color:#667085; }
            table { width:100%; border-collapse:collapse; }
            th, td { border:1px solid #d0d5dd; padding:9px; text-align:left; vertical-align:top; font-size:12px; }
            th { background:#f2f4f7; }
            .head { border-bottom:3px solid #1268ff; padding-bottom:18px; margin-bottom:24px; }
          </style>
        </head>
        <body>
          <div class="head">
            <h1>Activity Log</h1>
            <p>Generated ${new Date().toLocaleString()}</p>
          </div>
          <table>
            <thead>
              <tr><th>#</th><th>Date</th><th>Reference</th><th>Type</th><th>Actor</th><th>Note</th></tr>
            </thead>
            <tbody>${content}</tbody>
          </table>
          <script>window.print();</script>
        </body>
      </html>
    `;

    const w = window.open('', '_blank');
    if (!w) {
      alert('Popup blocked. Please allow popups for this dashboard.');
      return;
    }

    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  return (
    <Page title="Activity" sub="Audit trail for workflow actions, internal notes and customer updates.">
      <section className="activity-audit-strip vp-activity-stats-polished">
        <article><i><Activity size={18}/></i><div><span>Total Events</span><strong>{rows.length}</strong><small>latest audit records</small></div></article>
        <article className="today"><i><CalendarCheck size={18}/></i><div><span>Today</span><strong>{todayActivityCount}</strong><small>{todayKeyValue}</small></div></article>
        <article className="whatsapp"><i><MessageCircle size={18}/></i><div><span>Customer Comms</span><strong>{whatsappActivityCount}</strong><small>WhatsApp / updates</small></div></article>
        <article className="workflow"><i><BriefcaseBusiness size={18}/></i><div><span>Workflow Events</span><strong>{workflowActivityCount}</strong><small>jobs / claims / bookings</small></div></article>
      </section>
      <SpotlightCard className="panel-card activity-audit-console vp-activity-shell-polished">
        <div className="activity-console-head"><div><span>WORKSHOP AUDIT LOG</span><h2>Activity Timeline</h2><p>Every workflow change, note and customer update in chronological order.</p></div><b>{filteredRows.length} visible</b></div>
        <div className="activity-toolbar">
          <div className="filter-search">
            <span>Search Activity</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ref, note, actor, type..." />
          </div>

          <div className="filter-status">
            <span>Type</span>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="all">All</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <strong>{filteredRows.length} records</strong>
        </div>

        <div className="table-tools">
          <button onClick={loadActivity}>{loading ? 'Refreshing...' : 'Refresh Activity'}</button>
          <button onClick={exportActivity}>Export Activity CSV</button>
          <button onClick={printActivity}>Print Activity</button>
        </div>

        {loading ? (
          <EmptyState title="Loading activity..." />
        ) : !filteredRows.length ? (
          <EmptyState title="No activity found" copy="Try another search or type filter." />
        ) : (
          <div className="activity-list activity-timeline">
            {filteredRows.map(row => (
              <div className="activity-row audit-event" key={row.id}>
                <div className="activity-icon">
                  <ShieldCheck size={18} />
                </div>

                <div>
                  <div className="activity-row-head">
                    <strong>{row.type || 'note'}</strong>
                    <span>{row.createdAt || ''}</span>
                  </div>
                  <p>{row.note}</p>
                  <small>{row.ref || 'No ref'} • {row.actor || 'studio'}</small>
                </div>
              </div>
            ))}
          </div>
        )}
      </SpotlightCard>

      <MadeBy />
    </Page>
  );
}



const FITTER_FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'phone', label: 'WhatsApp number', placeholder: '+263...' },
  { key: 'role', label: 'Role', type: 'select', options: ['Fitter', 'Technician', 'Installer', 'Supervisor', 'Sales', 'Admin'] },
  { key: 'notes', label: 'Notes', type: 'textarea', large: true }
];

function TeamPage({ api, data = {}, refreshTick = 0 }) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadTeam(silent = false) {
    if (!silent) setLoading(true);
    try {
      const result = await api('/fitters');
      const list = result.fitters || [];
      setRows(list);
      setSelected(current => current ? (list.find(x => x.id === current.id) || list[0] || null) : (list[0] || null));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadTeam();
  }, []);
  useStudioRefreshPulse(refreshTick, () => loadTeam(true));

  const filteredRows = rows
    .filter(row => showInactive ? true : Number(row.active) === 1)
    .filter(row => matchesSearch(row, search));

  const assignedWork = [
    ...(data.bookings || []),
    ...(data.quotes || []),
    ...(data.jobs || [])
  ].filter(row => {
    const assigned = row.fitter || row.assignedTo || row.assigned_to || row.data?.fitter || '';
    return selected?.name && String(assigned).toLowerCase() === String(selected.name).toLowerCase();
  });

  useEffect(() => {
    if (filteredRows.length && !filteredRows.some(r => r.id === selected?.id)) {
      setSelected(filteredRows[0]);
    }
    if (!filteredRows.length) setSelected(null);
  }, [search, showInactive, rows]);

  async function createFitter(form) {
    await api('/fitters', 'POST', form);
    setModalOpen(false);
    alert('Team member saved.');
    await loadTeam();
  }

  async function setActive(active) {
    if (!selected?.id) return;
    await api(`/fitters/${selected.id}/status`, 'POST', { active });
    await loadTeam();
  }

  async function messageFitter() {
    if (!selected?.phone) {
      alert('This team member has no phone number saved.');
      return;
    }

    const msg = prompt('Message to team member:');
    if (!msg) return;

    await api('/message', 'POST', { phone: selected.phone, message: msg });
    alert('Message sent.');
  }

  function exportTeam() {
    const exportRows = filteredRows.map(row => ({
      ref: `FITTER-${row.id}`,
      customer: row.name || '',
      phone: row.phone || '',
      vehicle: '',
      registration: '',
      service: row.role || '',
      status: Number(row.active) === 1 ? 'Active' : 'Inactive',
      updatedAt: row.updatedAt || row.createdAt || ''
    }));

    downloadCSV('team-fitters-export.csv', exportRows);
  }

  function printTeamMember() {
    if (!selected) return;

    printCard(`Team Member - ${selected.name}`, [
      ['Name', selected.name],
      ['Phone', selected.phone || '-'],
      ['Role', selected.role || '-'],
      ['Status', Number(selected.active) === 1 ? 'Active' : 'Inactive'],
      ['Notes', selected.notes || '-'],
      ['Created', selected.createdAt || '-'],
      ['Updated', selected.updatedAt || '-']
    ]);
  }

  return (
    <Page title="Team" sub="Manage fitters, technicians, installers and workshop staff.">
      <div className="split">
        <SpotlightCard className="panel-card">
          <SectionHead title="Team Members" action="Add Team Member" onClick={() => setModalOpen(true)} />

          <div className="team-toolbar">
            <div className="filter-search">
              <span>Search Team</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, phone, role..." />
            </div>

            <label className="team-toggle">
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
              Show inactive
            </label>

            <strong>{filteredRows.length} people</strong>
          </div>

          <div className="table-tools">
            <button onClick={loadTeam}>{loading ? 'Refreshing...' : 'Refresh Team'}</button>
            <button onClick={exportTeam}>Export Team CSV</button>
          </div>

          {!filteredRows.length ? (
            <EmptyState title="No team members found" copy="Add fitters or technicians to start building your workshop team list." />
          ) : (
            <div className="team-list">
              {filteredRows.map(row => (
                <button key={row.id} onClick={() => setSelected(row)} className={selected?.id === row.id ? 'active' : ''}>
                  <div className="team-avatar">{String(row.name || '?').slice(0, 1).toUpperCase()}</div>
                  <div>
                    <strong>{row.name}</strong>
                    <small>{row.role || 'Fitter'} • {row.phone || 'No phone'}</small>
                  </div>
                  <Badge>{Number(row.active) === 1 ? 'Active' : 'Inactive'}</Badge>
                </button>
              ))}
            </div>
          )}
        </SpotlightCard>

        <SpotlightCard className="panel-card sticky">
          {!selected ? (
            <EmptyState title="No team member selected" />
          ) : (
            <>
              <DetailHead label="Team Member" refNo={selected.name} status={Number(selected.active) === 1 ? 'Active' : 'Inactive'} />

              <InfoGrid items={[
                ['Phone', selected.phone || '-'],
                ['Role', selected.role || '-'],
                ['Assigned Work', assignedWork.length],
                ['Notes', selected.notes || '-'],
                ['Created', selected.createdAt || '-'],
                ['Updated', selected.updatedAt || '-']
              ]} />

              <div className="actions">
                <button className="primary" onClick={messageFitter}><MessageCircle size={15} /> Message Team Member</button>
                <button onClick={printTeamMember}>Print Team Profile</button>
                {Number(selected.active) === 1 ? (
                  <button onClick={() => setActive(false)}>Deactivate</button>
                ) : (
                  <button onClick={() => setActive(true)}>Reactivate</button>
                )}
              </div>

              <MiniSection title="Assigned Work" rows={assignedWork} />
            </>
          )}
        </SpotlightCard>
      </div>

      {modalOpen && (
        <FormModal
          title="Add Team Member"
          fields={FITTER_FIELDS}
          onClose={() => setModalOpen(false)}
          onSubmit={createFitter}
        />
      )}

      <MadeBy />
    </Page>
  );
}



async function chooseTeamFitter(api) {
  try {
    const result = await api('/fitters');
    const fitters = (result.fitters || []).filter(f => Number(f.active) === 1);

    if (!fitters.length) {
      const manual = prompt('No active team members found. Type fitter / technician name:');
      return manual || '';
    }

    const menu = fitters.map((f, i) => `${i + 1}. ${f.name}${f.role ? ` - ${f.role}` : ''}${f.phone ? ` (${f.phone})` : ''}`).join('\n');
    const answer = prompt(`Choose fitter by number, or type a new name:\n\n${menu}`);

    if (!answer) return '';

    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= fitters.length) {
      return fitters[n - 1].name;
    }

    return answer.trim();
  } catch {
    const manual = prompt('Could not load team list. Type fitter / technician name:');
    return manual || '';
  }
}



const PART_FIELDS = [
  { key: 'sku', label: 'Product / Stock Code', placeholder: 'Example: MB-W202-FWS' },
  { key: 'name', label: 'Product / Glass Name', placeholder: 'Example: Mercedes-Benz C-Class W202 Front Windscreen' },
  { key: 'vehicleMake', label: 'Vehicle Make', placeholder: 'Mercedes-Benz' },
  { key: 'vehicleModel', label: 'Vehicle Model', placeholder: 'C-Class' },
  { key: 'modelAliases', label: 'Model Aliases / Chassis Code', placeholder: 'W202; 202 Series' },
  { key: 'yearFrom', label: 'Year From', inputType: 'number', placeholder: '1998' },
  { key: 'yearTo', label: 'Year To', inputType: 'number', placeholder: '2002' },
  { key: 'glassPosition', label: 'Glass Position', type: 'select', options: ['Front Windscreen', 'Rear Glass', 'Front Left Door Glass', 'Front Right Door Glass', 'Rear Left Door Glass', 'Rear Right Door Glass', 'Quarter Glass', 'Other'] },
  { key: 'category', label: 'Category', type: 'select', options: ['Windscreen', 'Side Glass', 'Rear Glass', 'Tint', 'Adhesive', 'Rubber / Moulding', 'Sensor / Mirror', 'General'] },
  { key: 'quantity', label: 'Stock Quantity', inputType: 'number', placeholder: '4' },
  { key: 'lowStock', label: 'Low Stock Alert Level', inputType: 'number', placeholder: '1' },
  { key: 'sellingPrice', label: 'Selling Price before VAT (USD)', inputType: 'number', placeholder: '121.20' },
  { key: 'costPrice', label: 'Cost Price USD', inputType: 'number', placeholder: '120' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'smartQuoteEnabled', label: 'Use for Smart Quotations', type: 'select', options: ['Yes', 'No'] },
  { key: 'fitmentDescription', label: 'Quotation / Fitment Description', type: 'textarea', large: true, placeholder: 'Front windscreen including fitting.' },
  { key: 'notes', label: 'Internal Notes', type: 'textarea', large: true }
];

const STOCK_TEMPLATE_HEADERS = [
  'Product Code', 'Name', 'Vehicle Make', 'Vehicle Model', 'Model Aliases', 'Year From', 'Year To',
  'Glass Position', 'Category', 'Description', 'Selling Price', 'Cost Price', 'Stock Quantity',
  'Low Stock', 'Supplier', 'Active', 'Smart Quote Enabled', 'Notes'
];

function downloadStockCsvFile(filename, headers, rows) {
  const csv = [
    headers.map(csvEscape).join(','),
    ...rows.map(row => headers.map(header => csvEscape(row[header] ?? '')).join(','))
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function PartsPage({ api, refreshTick = 0 }) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('active');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const importRef = useRef(null);

  async function loadParts(silent = false) {
    if (!silent) setLoading(true);
    try {
      const result = await api('/parts');
      const list = result.parts || [];
      setRows(list);
      setSelected(current => {
        if (!current) return list[0] || null;
        return list.find(x => x.id === current.id) || list[0] || null;
      });
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadParts();
  }, []);
  useStudioRefreshPulse(refreshTick, () => loadParts(true));

  const filteredRows = rows
    .filter(row => {
      if (view === 'all') return true;
      if (view === 'low') return Number(row.quantity || 0) > 0 && Number(row.quantity || 0) <= Number(row.lowStock || 0);
      if (view === 'out') return Number(row.quantity || 0) <= 0;
      if (view === 'smart') return Number(row.active) === 1 && Number(row.smartQuoteEnabled) === 1;
      return Number(row.active) === 1;
    })
    .filter(row => matchesSearch(row, search));

  useEffect(() => {
    if (filteredRows.length && !filteredRows.some(r => r.id === selected?.id)) {
      setSelected(filteredRows[0]);
    }
    if (!filteredRows.length) setSelected(null);
  }, [search, view, rows]);

  const lowStockCount = rows.filter(r => Number(r.quantity || 0) > 0 && Number(r.quantity || 0) <= Number(r.lowStock || 0) && Number(r.active) === 1).length;
  const outOfStockCount = rows.filter(r => Number(r.quantity || 0) <= 0 && Number(r.active) === 1).length;
  const smartItems = rows.filter(r => Number(r.active) === 1 && Number(r.smartQuoteEnabled) === 1).length;
  const totalStockValue = rows.reduce((t, r) => t + (Number(r.quantity || 0) * Number(r.costPrice || 0)), 0);

  async function createPart(form) {
    await api('/parts', 'POST', form);
    setModalOpen(false);
    alert('Stock item saved.');
    await loadParts();
  }

  async function updatePart(form) {
    if (!selected?.id) return;
    await api(`/parts/${selected.id}`, 'PATCH', form);
    setEditOpen(false);
    alert('Stock item updated.');
    await loadParts();
  }

  async function adjustStock(direction) {
    if (!selected?.id) return;
    const raw = prompt(direction === 'in' ? 'Stock IN quantity:' : 'Stock OUT quantity:');
    if (!raw) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      alert('Enter a valid quantity.');
      return;
    }
    const reason = prompt('Reason / note:', direction === 'in' ? 'Stock received' : 'Manual stock issue');
    if (!reason) return;
    await api(`/parts/${selected.id}/adjust`, 'POST', { amount: direction === 'in' ? n : -n, reason });
    await loadParts();
  }

  async function setActive(active) {
    if (!selected?.id) return;
    await api(`/parts/${selected.id}/status`, 'POST', { active });
    await loadParts();
  }

  function downloadTemplate() {
    downloadStockCsvFile('windscreen-stock-import-template.csv', STOCK_TEMPLATE_HEADERS, [{
      'Product Code': 'MB-W202-FWS',
      Name: 'Mercedes-Benz C-Class W202 Front Windscreen',
      'Vehicle Make': 'Mercedes-Benz',
      'Vehicle Model': 'C-Class',
      'Model Aliases': 'W202; 202 Series',
      'Year From': '1998',
      'Year To': '2002',
      'Glass Position': 'Front Windscreen',
      Category: 'Windscreen',
      Description: 'Front windscreen including fitting.',
      'Selling Price': '180',
      'Cost Price': '120',
      'Stock Quantity': '4',
      'Low Stock': '1',
      Supplier: '',
      Active: 'Yes',
      'Smart Quote Enabled': 'Yes',
      Notes: ''
    }]);
  }

  function exportStock() {
    if (!filteredRows.length) {
      alert('No stock records to export.');
      return;
    }
    const exportRows = filteredRows.map(row => ({
      'Product Code': row.sku || '',
      Name: row.name || '',
      'Vehicle Make': row.vehicleMake || '',
      'Vehicle Model': row.vehicleModel || '',
      'Model Aliases': row.modelAliases || '',
      'Year From': row.yearFrom ?? '',
      'Year To': row.yearTo ?? '',
      'Glass Position': row.glassPosition || '',
      Category: row.category || '',
      Description: row.fitmentDescription || '',
      'Selling Price': Number(row.sellingPrice || 0),
      'Cost Price': Number(row.costPrice || 0),
      'Stock Quantity': Number(row.quantity || 0),
      'Low Stock': Number(row.lowStock || 0),
      Supplier: row.supplier || '',
      Active: Number(row.active) === 1 ? 'Yes' : 'No',
      'Smart Quote Enabled': Number(row.smartQuoteEnabled) === 1 ? 'Yes' : 'No',
      Notes: row.notes || ''
    }));
    downloadStockCsvFile('windscreen-stock-catalogue.csv', STOCK_TEMPLATE_HEADERS, exportRows);
  }

  async function importStockFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      alert('Please choose a CSV or XLSX file.');
      return;
    }
    if (file.size > 18 * 1024 * 1024) {
      alert('Import file is too large. Maximum 18 MB.');
      return;
    }
    setImporting(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read import file.'));
        reader.readAsDataURL(file);
      });
      const contentBase64 = dataUrl.split(',')[1] || '';
      const preview = await api('/parts/import', 'POST', { fileName: file.name, contentBase64, dryRun: true });
      const summary = preview.summary || {};
      const approved = confirm(
        `Import preview for ${file.name}:\n\n` +
        `${summary.total || 0} usable rows\n` +
        `${summary.inserted || 0} new items\n` +
        `${summary.updated || 0} existing items to update\n` +
        `${summary.skipped || 0} skipped\n\n` +
        `Continue with import?`
      );
      if (!approved) return;
      const result = await api('/parts/import', 'POST', { fileName: file.name, contentBase64, dryRun: false });
      const done = result.summary || {};
      alert(`Import complete. ${done.inserted || 0} inserted, ${done.updated || 0} updated, ${done.skipped || 0} skipped.`);
      await loadParts();
    } catch (err) {
      alert(err.message || 'Stock import failed.');
    } finally {
      setImporting(false);
    }
  }

  function stockStatus(row) {
    const qty = Number(row?.quantity || 0);
    if (Number(row?.active) !== 1) return 'Inactive';
    if (qty <= 0) return 'Out of Stock';
    if (qty <= Number(row?.lowStock || 0)) return 'Low Stock';
    return 'In Stock';
  }

  function printPartProfile() {
    if (!selected) return;
    printCard(`Stock Profile - ${selected.name}`, [
      ['Product Code', selected.sku || '-'],
      ['Vehicle Make', selected.vehicleMake || '-'],
      ['Vehicle Model', selected.vehicleModel || '-'],
      ['Aliases / Chassis', selected.modelAliases || '-'],
      ['Year Range', selected.yearFrom ? `${selected.yearFrom}${selected.yearTo ? `–${selected.yearTo}` : ''}` : '-'],
      ['Glass Position', selected.glassPosition || '-'],
      ['Category', selected.category || '-'],
      ['Quantity', selected.quantity ?? 0],
      ['Low Stock Alert', selected.lowStock ?? 0],
      ['Supplier', selected.supplier || '-'],
      ['Cost Price', `$${Number(selected.costPrice || 0).toFixed(2)}`],
      ['Selling Price', `$${Number(selected.sellingPrice || 0).toFixed(2)}`],
      ['Smart Quotations', Number(selected.smartQuoteEnabled) === 1 ? 'Enabled' : 'Disabled'],
      ['Description', selected.fitmentDescription || '-'],
      ['Status', stockStatus(selected)],
      ['Notes', selected.notes || '-']
    ]);
  }

  const editValues = selected ? {
    sku: selected.sku || '',
    name: selected.name || '',
    vehicleMake: selected.vehicleMake || '',
    vehicleModel: selected.vehicleModel || '',
    modelAliases: selected.modelAliases || '',
    yearFrom: selected.yearFrom ?? '',
    yearTo: selected.yearTo ?? '',
    glassPosition: selected.glassPosition || '',
    category: selected.category || '',
    quantity: selected.quantity ?? 0,
    lowStock: selected.lowStock ?? 1,
    sellingPrice: selected.sellingPrice ?? 0,
    costPrice: selected.costPrice ?? 0,
    supplier: selected.supplier || '',
    smartQuoteEnabled: Number(selected.smartQuoteEnabled) === 1 ? 'Yes' : 'No',
    fitmentDescription: selected.fitmentDescription || '',
    notes: selected.notes || ''
  } : {};

  return (
    <Page title="Stock Catalogue" sub="Manage vehicle glass stock, year ranges, prices and Smart Quotation matching.">
      <div className="parts-summary vp-stock-summary">
        <SpotlightCard className="parts-mini-card stock-metric total">
          <i><ClipboardList size={18}/></i><div><span>Total Products</span>
          <strong>{rows.length}</strong>
          <small>catalogue items</small></div>
        </SpotlightCard>
        <SpotlightCard className="parts-mini-card money stock-metric smart">
          <i><CheckCircle2 size={18}/></i><div><span>Smart Quote Ready</span>
          <strong>{smartItems}</strong>
          <small>vehicle-matched products</small></div>
        </SpotlightCard>
        <SpotlightCard className="parts-mini-card urgent stock-metric low">
          <i><AlertTriangle size={18}/></i><div><span>Low / Out Stock</span>
          <strong>{lowStockCount + outOfStockCount}</strong>
          <small>{outOfStockCount} out of stock</small></div>
        </SpotlightCard>
        <SpotlightCard className="parts-mini-card money stock-metric value">
          <i><BriefcaseBusiness size={18}/></i><div><span>Stock Cost Value</span>
          <strong>${totalStockValue.toFixed(2)}</strong>
          <small>estimated inventory value</small></div>
        </SpotlightCard>
      </div>

      <div className="split vp-stock-split">
        <SpotlightCard className="panel-card stock-catalogue-panel">
          <div className="stock-catalogue-head">
            <div><span>FITMENT CATALOGUE</span><h2>Vehicle Glass Inventory</h2><p>Search by make, model, year, code or glass position.</p></div>
            <button className="primary" type="button" onClick={() => setModalOpen(true)}>+ Add Stock Item</button>
          </div>

          <div className="parts-toolbar vp-stock-toolbar">
            <div className="filter-search">
              <span>Search Stock</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search make, model, year, code, glass type..." />
            </div>
            <div className="filter-status">
              <span>View</span>
              <select value={view} onChange={e => setView(e.target.value)}>
                <option value="active">Active</option>
                <option value="smart">Smart Quote Ready</option>
                <option value="low">Low Stock</option>
                <option value="out">Out of Stock</option>
                <option value="all">All</option>
              </select>
            </div>
            <strong>{filteredRows.length} products</strong>
          </div>

          <div className="table-tools vp-stock-tools">
            <button onClick={loadParts}>{loading ? 'Refreshing…' : 'Refresh'}</button>
            <button onClick={() => importRef.current?.click()} disabled={importing}>{importing ? 'Importing…' : 'Import CSV / Excel'}</button>
            <button onClick={downloadTemplate}>Download Import Template</button>
            <button onClick={exportStock}>Export Catalogue CSV</button>
            <input ref={importRef} type="file" accept=".csv,.xlsx" hidden onChange={importStockFile} />
          </div>

          {!filteredRows.length ? (
            <div className="stock-empty-onboarding">
              <div className="stock-empty-icon"><ClipboardList size={28}/></div>
              <span>STOCK CATALOGUE IS EMPTY</span>
              <h3>Add your first vehicle glass product</h3>
              <p>For Smart Quotations, include the product code, vehicle make, model, year range, glass position, selling price and quantity.</p>
              <div><button className="primary" type="button" onClick={() => setModalOpen(true)}>Add Stock Item</button><button type="button" onClick={() => importRef.current?.click()}>Import CSV / Excel</button></div>
            </div>
          ) : (
            <div className="parts-list vp-stock-list">
              {filteredRows.map(row => {
                const status = stockStatus(row);
                return (
                  <button key={row.id} onClick={() => setSelected(row)} className={selected?.id === row.id ? 'active' : ''}>
                    <div>
                      <strong>{row.name}</strong>
                      <small>{row.sku || 'No code'} • {row.vehicleMake || 'General'} {row.vehicleModel || ''} {row.yearFrom ? `• ${row.yearFrom}${row.yearTo ? `–${row.yearTo}` : ''}` : ''}</small>
                    </div>
                    <div>
                      <b>USD {Number(row.sellingPrice || 0).toFixed(2)}</b>
                      <small>{Number(row.quantity || 0)} in stock</small>
                    </div>
                    <Badge>{status}</Badge>
                  </button>
                );
              })}
            </div>
          )}
        </SpotlightCard>

        <SpotlightCard className="panel-card sticky stock-product-detail">
          {!selected ? (
            <div className="stock-detail-empty"><Car size={28}/><span>PRODUCT PROFILE</span><h3>No stock item selected</h3><p>Add or import a product, then select it to view fitment, pricing and stock controls.</p></div>          ) : (
            <>
              <DetailHead label="Stock Item" refNo={selected.sku || `PART-${selected.id}`} status={stockStatus(selected)} />

              <div className="stock-fitment-hero">
                <div className="stock-fitment-code"><span>PRODUCT CODE</span><strong>{selected.sku || `PART-${selected.id}`}</strong></div>
                <div><span>Vehicle Fitment</span><strong>{selected.vehicleMake || 'General'} {selected.vehicleModel || ''}</strong><small>{selected.yearFrom ? `${selected.yearFrom}${selected.yearTo ? `–${selected.yearTo}` : ''}` : 'Year range not set'} · {selected.glassPosition || 'Glass position not set'}</small></div>
                <div className="stock-quantity-hero"><span>Available</span><strong>{selected.quantity ?? 0}</strong><small>units</small></div>
                <div className="stock-price-hero"><span>Selling Price</span><strong>USD {Number(selected.sellingPrice || 0).toFixed(2)}</strong><small>{Number(selected.smartQuoteEnabled) === 1 ? 'Smart Quote enabled' : 'Manual quote only'}</small></div>
              </div>

              <InfoGrid items={[
                ['Product / Glass', selected.name || '-'],
                ['Vehicle Make', selected.vehicleMake || '-'],
                ['Vehicle Model', selected.vehicleModel || '-'],
                ['Aliases / Chassis', selected.modelAliases || '-'],
                ['Year Range', selected.yearFrom ? `${selected.yearFrom}${selected.yearTo ? `–${selected.yearTo}` : ''}` : '-'],
                ['Glass Position', selected.glassPosition || '-'],
                ['Category', selected.category || '-'],
                ['Stock Quantity', selected.quantity ?? 0],
                ['Low Stock Alert', selected.lowStock ?? 0],
                ['Selling Price before VAT', `USD ${Number(selected.sellingPrice || 0).toFixed(2)}`],
                ['Cost Price', `USD ${Number(selected.costPrice || 0).toFixed(2)}`],
                ['Supplier', selected.supplier || '-'],
                ['Smart Quotations', Number(selected.smartQuoteEnabled) === 1 ? 'Enabled' : 'Disabled'],
                ['Fitment Description', selected.fitmentDescription || '-'],
                ['Internal Notes', selected.notes || '-']
              ]} />

              <div className="actions vp-stock-actions">
                <button className="primary" onClick={() => setEditOpen(true)}>Edit Stock Item</button>
                <button onClick={() => adjustStock('in')}>Stock In</button>
                <button onClick={() => adjustStock('out')}>Stock Out</button>
                <button onClick={printPartProfile}>Print Profile</button>
                {Number(selected.active) === 1 ? (
                  <button onClick={() => setActive(false)}>Deactivate</button>
                ) : (
                  <button onClick={() => setActive(true)}>Reactivate</button>
                )}
              </div>

              <div className="vp-stock-rule-box">
                <strong>Smart Quotation Rule</strong>
                <p>The bot only uses this price when make, model and year fit safely. If the match is uncertain, staff must select the correct product. Sending a quotation does not reduce stock.</p>
              </div>
            </>
          )}
        </SpotlightCard>
      </div>

      {modalOpen && (
        <FormModal
          title="Add Stock Item"
          fields={PART_FIELDS}
          initialValues={{ smartQuoteEnabled: 'Yes', category: 'Windscreen', glassPosition: 'Front Windscreen', lowStock: 1 }}
          onClose={() => setModalOpen(false)}
          onSubmit={createPart}
        />
      )}

      {editOpen && selected && (
        <FormModal
          title="Edit Stock Item"
          fields={PART_FIELDS}
          initialValues={editValues}
          onClose={() => setEditOpen(false)}
          onSubmit={updatePart}
        />
      )}

      <MadeBy />
    </Page>
  );
}


function JobPartsPanel({ api, selected, reload, refreshTick = 0 }) {
  const [usedParts, setUsedParts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(false);

  async function loadJobParts(silent = false) {
    if (!selected?.jobNo) {
      setUsedParts([]);
      return;
    }

    if (!silent) setLoading(true);
    try {
      const result = await api(`/jobs/${selected.jobNo}/parts`);
      setUsedParts(result.parts || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadInventory() {
    try {
      const result = await api('/parts');
      setInventory(result.parts || []);
    } catch {
      setInventory([]);
    }
  }

  useEffect(() => {
    loadJobParts();
    loadInventory();
  }, [selected?.jobNo]);
  useStudioRefreshPulse(refreshTick, () => {
    loadJobParts(true);
    loadInventory();
  });

  async function addPartToJob() {
    if (!selected?.jobNo) return;

    let activeParts = inventory.filter(p => Number(p.active) === 1);

    if (!activeParts.length) {
      await loadInventory();
      activeParts = inventory.filter(p => Number(p.active) === 1);
    }

    if (!activeParts.length) {
      alert('No active parts found. Add parts in the Parts tab first.');
      return;
    }

    const menu = activeParts
      .map((p, i) => `${i + 1}. ${p.name} | Stock: ${p.quantity ?? 0} | ${p.sku || 'No SKU'}`)
      .join('\n');

    const answer = prompt(`Choose part by number:\n\n${menu}`);
    if (!answer) return;

    const n = Number(answer);
    if (!Number.isInteger(n) || n < 1 || n > activeParts.length) {
      alert('Invalid part number.');
      return;
    }

    const part = activeParts[n - 1];
    const qtyRaw = prompt(`Quantity to use for ${part.name}:`);
    if (!qtyRaw) return;

    const qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || qty <= 0) {
      alert('Enter a valid quantity.');
      return;
    }

    await api(`/jobs/${selected.jobNo}/parts`, 'POST', {
      partId: part.id,
      quantity: qty
    });

    alert('Part added to job and stock reduced.');
    await loadJobParts();
    await loadInventory();
    await reload();
  }

  async function removePart(row) {
    if (!selected?.jobNo || !row?.id) return;
    if (!confirm(`Remove ${row.quantity} x ${row.partName} from this job and restore stock?`)) return;

    await api(`/jobs/${selected.jobNo}/parts/${row.id}/remove`, 'POST', {});
    await loadJobParts();
    await loadInventory();
    await reload();
  }

  const total = usedParts.reduce((t, p) => t + Number(p.total || 0), 0);

  return (
    <div className="job-parts-panel">
      <div className="job-parts-head">
        <div>
          <h3>Parts / Materials Used</h3>
          <p>{usedParts.length} item(s) • ${total.toFixed(2)} estimated value</p>
        </div>
        <button className="primary" onClick={addPartToJob}>Add Part Used</button>
      </div>

      {loading ? (
        <div className="note-empty">Loading parts...</div>
      ) : !usedParts.length ? (
        <div className="note-empty">No parts recorded on this job yet.</div>
      ) : (
        <div className="job-parts-list">
          {usedParts.map(row => (
            <div className="job-part-row" key={row.id}>
              <div>
                <strong>{row.partName}</strong>
                <small>{row.sku || 'No SKU'} • {row.createdAt || ''}</small>
              </div>

              <div>
                <b>{row.quantity}</b>
                <small>qty</small>
              </div>

              <div>
                <b>${Number(row.total || 0).toFixed(2)}</b>
                <small>${Number(row.unitPrice || 0).toFixed(2)} each</small>
              </div>

              <button onClick={() => removePart(row)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}



function quoteValueOf(row) {
  return Number(row?.quoteAmount || row?.quote_amount || row?.data?.quoteAmount || 0);
}

function PaymentPanel({ api, selected, reload, refreshTick = 0 }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);

  async function loadPayments(silent = false) {
    if (!selected?.jobNo) {
      setPayments([]);
      return;
    }

    if (!silent) setLoading(true);
    try {
      const result = await api(`/jobs/${selected.jobNo}/payments`);
      setPayments(result.payments || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadPayments();
  }, [selected?.jobNo]);
  useStudioRefreshPulse(refreshTick, () => loadPayments(true));

  const quote = quoteValueOf(selected);
  const paid = payments.reduce((t, p) => t + Number(p.amount || 0), 0);
  const balance = Math.max(0, quote - paid);

  async function recordPayment() {
    if (!selected?.jobNo) return;

    const amountRaw = prompt('Payment amount USD:');
    if (!amountRaw) return;

    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Enter a valid payment amount.');
      return;
    }

    const method = prompt('Payment method:', 'Cash');
    if (!method) return;

    const paymentType = prompt('Payment type:', balance > amount ? 'Part Payment' : 'Final Payment');
    if (!paymentType) return;

    const note = prompt('Payment note:', '') || '';

    await api(`/jobs/${selected.jobNo}/payments`, 'POST', {
      amount,
      method,
      paymentType,
      note
    });

    alert('Payment recorded.');
    await loadPayments();
    await reload();
  }

  function printReceipt(row) {
    printCard(`Payment Receipt - ${selected.jobNo}`, [
      ['Job No', selected.jobNo],
      ['Customer', selected.customerName || '-'],
      ['Phone', selected.customerPhone || '-'],
      ['Vehicle', selected.vehicle || '-'],
      ['Amount', `$${Number(row.amount || 0).toFixed(2)}`],
      ['Method', row.method || '-'],
      ['Type', row.paymentType || '-'],
      ['Date', row.createdAt || '-'],
      ['Note', row.note || '-']
    ]);
  }

  return (
    <div className="payment-panel">
      <div className="payment-head">
        <div>
          <h3>Payments</h3>
          <p>Quote: ${quote.toFixed(2)} • Paid: ${paid.toFixed(2)} • Balance: ${balance.toFixed(2)}</p>
        </div>
        <button className="primary" onClick={recordPayment}>Record Payment</button>
      </div>

      <div className="payment-summary-grid">
        <div><strong>${quote.toFixed(2)}</strong><span>Quote</span></div>
        <div><strong>${paid.toFixed(2)}</strong><span>Paid</span></div>
        <div className={balance > 0 ? 'danger' : 'success'}><strong>${balance.toFixed(2)}</strong><span>Balance</span></div>
      </div>

      {loading ? (
        <div className="note-empty">Loading payments...</div>
      ) : !payments.length ? (
        <div className="note-empty">No payments recorded yet.</div>
      ) : (
        <div className="payment-list">
          {payments.map(row => (
            <div className="payment-row" key={row.id}>
              <div>
                <strong>${Number(row.amount || 0).toFixed(2)}</strong>
                <small>{row.paymentType || 'Payment'} • {row.method || '-'}</small>
              </div>

              <div>
                <b>{row.createdAt || '-'}</b>
                <small>{row.note || 'No note'}</small>
              </div>

              <button onClick={() => printReceipt(row)}>Print Receipt</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PaymentsPage({ data, api, reload, refreshTick = 0 }) {
  const [payments, setPayments] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const jobs = [
    ...(data.bookings || []),
    ...(data.quotes || []),
    ...(data.jobs || [])
  ].filter((row, index, arr) => {
    const id = row.jobNo || row.ref || `${row.customerPhone}-${row.createdAt}`;
    return arr.findIndex(x => (x.jobNo || x.ref || `${x.customerPhone}-${x.createdAt}`) === id) === index;
  });

  async function loadPayments(silent = false) {
    if (!silent) setLoading(true);
    try {
      const result = await api('/payments');
      setPayments(result.payments || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadPayments();
  }, []);
  useStudioRefreshPulse(refreshTick, () => loadPayments(true));

  const rows = jobs.map(job => {
    const jobPayments = payments.filter(p => p.jobNo === job.jobNo);
    const paid = jobPayments.reduce((t, p) => t + Number(p.amount || 0), 0);
    const quote = quoteValueOf(job);
    const balance = Math.max(0, quote - paid);

    return {
      ...job,
      paid,
      quote,
      balance,
      paymentCount: jobPayments.length
    };
  }).filter(row => matchesSearch(row, search));

  const totalQuote = rows.reduce((t, r) => t + Number(r.quote || 0), 0);
  const totalPaid = rows.reduce((t, r) => t + Number(r.paid || 0), 0);
  const totalBalance = rows.reduce((t, r) => t + Number(r.balance || 0), 0);

  async function recordPayment(row) {
    if (!row?.jobNo) return;

    const amountRaw = prompt(`Payment amount for ${row.jobNo}:`);
    if (!amountRaw) return;

    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Enter a valid payment amount.');
      return;
    }

    const method = prompt('Payment method:', 'Cash');
    if (!method) return;

    const paymentType = prompt('Payment type:', row.balance > amount ? 'Part Payment' : 'Final Payment');
    if (!paymentType) return;

    const note = prompt('Payment note:', '') || '';

    await api(`/jobs/${row.jobNo}/payments`, 'POST', { amount, method, paymentType, note });
    alert('Payment recorded.');
    await loadPayments();
    await reload();
  }

  function exportPayments() {
    const exportRows = rows.map(row => ({
      ref: row.jobNo || '',
      customer: row.customerName || '',
      phone: row.customerPhone || '',
      vehicle: row.vehicle || '',
      registration: row.registration || '',
      service: row.service || '',
      status: `Quote ${row.quote} | Paid ${row.paid} | Balance ${row.balance}`,
      updatedAt: row.updatedAt || row.createdAt || ''
    }));

    downloadCSV('payments-report.csv', exportRows);
  }

  function printPaymentsReport() {
    printCard('Payments Report', [
      ['Records', rows.length],
      ['Total Quote Value', `$${totalQuote.toFixed(2)}`],
      ['Total Paid', `$${totalPaid.toFixed(2)}`],
      ['Total Balance', `$${totalBalance.toFixed(2)}`],
      ['Generated', new Date().toLocaleString()]
    ]);
  }

  return (
    <Page title="Payments" sub="Track deposits, part payments, final payments and outstanding balances.">
      <div className="payment-kpis">
        <SpotlightCard className="payment-kpi"><span>Total Quote</span><strong>${totalQuote.toFixed(2)}</strong></SpotlightCard>
        <SpotlightCard className="payment-kpi success"><span>Total Paid</span><strong>${totalPaid.toFixed(2)}</strong></SpotlightCard>
        <SpotlightCard className="payment-kpi danger"><span>Outstanding</span><strong>${totalBalance.toFixed(2)}</strong></SpotlightCard>
      </div>

      <SpotlightCard className="panel-card">
        <div className="payments-toolbar">
          <div className="filter-search">
            <span>Search Payments</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search job, customer, phone, vehicle..." />
          </div>

          <strong>{rows.length} records</strong>
        </div>

        <div className="table-tools">
          <button onClick={loadPayments}>{loading ? 'Refreshing...' : 'Refresh Payments'}</button>
          <button onClick={exportPayments}>Export Payments CSV</button>
          <button onClick={printPaymentsReport}>Print Payments Report</button>
        </div>

        {!rows.length ? (
          <EmptyState title="No payment records found" copy="Set quote amounts and record payments from jobs." />
        ) : (
          <div className="payments-list">
            {rows.map(row => (
              <div className="payments-record" key={row.jobNo || row.ref}>
                <div>
                  <strong>{row.jobNo || row.ref}</strong>
                  <small>{row.customerName || row.customerPhone || '-'} • {row.vehicle || '-'}</small>
                </div>

                <div><b>${Number(row.quote || 0).toFixed(2)}</b><small>Quote</small></div>
                <div><b>${Number(row.paid || 0).toFixed(2)}</b><small>Paid</small></div>
                <div className={row.balance > 0 ? 'danger' : 'success'}><b>${Number(row.balance || 0).toFixed(2)}</b><small>Balance</small></div>

                <button className="primary" onClick={() => recordPayment(row)}>Record Payment</button>
              </div>
            ))}
          </div>
        )}
      </SpotlightCard>

      <MadeBy />
    </Page>
  );
}



function taskIsOverdue(task) {
  if (!task?.dueDate || task.status === 'done') return false;
  const today = todayKey();
  return String(task.dueDate) < today;
}


function TaskPanel({ api, selected, reload, refreshTick = 0 }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);

  async function loadTasks(silent = false) {
    if (!selected?.jobNo) {
      setTasks([]);
      return;
    }

    if (!silent) setLoading(true);
    try {
      const result = await api(`/tasks?ref=${encodeURIComponent(selected.jobNo)}`);
      setTasks(result.tasks || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadTasks();
  }, [selected?.jobNo]);
  useStudioRefreshPulse(refreshTick, () => loadTasks(true));

  async function createTask() {
    if (!selected?.jobNo) return;

    const title = prompt('Task / follow-up title:', 'Follow up with customer');
    if (!title) return;

    const taskType = prompt('Task type:', 'Follow Up') || 'Follow Up';
    const dueDate = prompt('Due date YYYY-MM-DD:', todayKey()) || '';
    const dueTime = prompt('Due time HH:MM:', '') || '';
    const assignedTo = prompt('Assigned to:', selected.fitter || selected.assignedTo || selected.data?.fitter || '') || '';
    const note = prompt('Task note:', '') || '';

    await api('/tasks', 'POST', {
      ref: selected.jobNo,
      customerPhone: selected.customerPhone,
      title,
      taskType,
      assignedTo,
      dueDate,
      dueTime,
      note
    });

    alert('Task created.');
    await loadTasks();
    await reload();
  }

  async function setTaskStatus(task, status) {
    await api(`/tasks/${task.id}/status`, 'POST', { status });
    await loadTasks();
    await reload();
  }

  async function remindCustomer(task) {
    await sendTaskCustomerReminder(api, task);
    await loadTasks();
  }

  async function remindTeam(task) {
    await sendTaskTeamReminder(api, task);
    await loadTasks();
  }

  return (
    <div className="task-panel">
      <div className="task-head">
        <div>
          <h3>Tasks / Follow-ups</h3>
          <p>{tasks.length} task(s) linked to this record</p>
        </div>
        <button className="primary" onClick={createTask}>Create Task</button>
      </div>

      {loading ? (
        <div className="note-empty">Loading tasks...</div>
      ) : !tasks.length ? (
        <div className="note-empty">No follow-up tasks yet.</div>
      ) : (
        <div className="task-list">
          {tasks.map(task => (
            <div className={`task-row ${task.status === 'done' ? 'done' : ''} ${taskIsOverdue(task) ? 'overdue' : ''}`} key={task.id}>
              <div>
                <strong>{task.title}</strong>
                <small>{task.taskType || 'Task'} • {task.dueDate || 'No date'} {task.dueTime || ''}</small>
                {task.note && <p>{task.note}</p>}
              </div>

              <div>
                <b>{task.assignedTo || 'Unassigned'}</b>
                <small>{task.status || 'open'}</small>
              </div>

              <div className="task-actions">
                {task.customerPhone && <button onClick={() => remindCustomer(task)}><MessageCircle size={14} /> Customer</button>}
                {task.assignedTo && <button onClick={() => remindTeam(task)}><MessageCircle size={14} /> Team</button>}
                {task.status === 'done' ? (
                  <button onClick={() => setTaskStatus(task, 'open')}>Reopen</button>
                ) : (
                  <button className="primary" onClick={() => setTaskStatus(task, 'done')}>Mark Done</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function TasksPage({ data, api, reload, refreshTick = 0 }) {
  const [tasks, setTasks] = useState([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('open');
  const [loading, setLoading] = useState(true);

  async function loadTasks(silent = false) {
    if (!silent) setLoading(true);
    try {
      const result = await api('/tasks');
      setTasks(result.tasks || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadTasks();
  }, []);
  useStudioRefreshPulse(refreshTick, () => loadTasks(true));

  const today = todayKey();

  const filteredTasks = tasks
    .filter(task => {
      if (view === 'all') return true;
      if (view === 'done') return task.status === 'done';
      if (view === 'overdue') return taskIsOverdue(task);
      if (view === 'today') return task.status !== 'done' && String(task.dueDate || '') === today;
      return task.status !== 'done';
    })
    .filter(task => matchesSearch(task, search));

  const openCount = tasks.filter(t => t.status !== 'done').length;
  const todayCount = tasks.filter(t => t.status !== 'done' && String(t.dueDate || '') === today).length;
  const overdueCount = tasks.filter(taskIsOverdue).length;

  async function createGeneralTask() {
    const title = prompt('Task title:');
    if (!title) return;

    const ref = prompt('Reference / job no optional:', '') || '';
    const customerPhone = prompt('Customer phone optional:', '') || '';
    const taskType = prompt('Task type:', 'Follow Up') || 'Follow Up';
    const dueDate = prompt('Due date YYYY-MM-DD:', today) || '';
    const dueTime = prompt('Due time HH:MM:', '') || '';
    const assignedTo = prompt('Assigned to:', '') || '';
    const note = prompt('Task note:', '') || '';

    await api('/tasks', 'POST', { ref, customerPhone, title, taskType, dueDate, dueTime, assignedTo, note });
    alert('Task created.');
    await loadTasks();
    await reload();
  }

  async function setTaskStatus(task, status) {
    await api(`/tasks/${task.id}/status`, 'POST', { status });
    await loadTasks();
    await reload();
  }

  async function remindCustomer(task) {
    await sendTaskCustomerReminder(api, task);
    await loadTasks();
  }

  async function remindTeam(task) {
    await sendTaskTeamReminder(api, task);
    await loadTasks();
  }

  async function remindAllDueToday() {
    const due = filteredTasks.filter(t => t.status !== 'done' && String(t.dueDate || '') === today);

    if (!due.length) {
      alert('No due-today tasks in the current view.');
      return;
    }

    if (!confirm(`Send reminders one-by-one for ${due.length} due-today task(s)?`)) return;

    for (const task of due) {
      if (task.customerPhone) await sendTaskCustomerReminder(api, task);
    }

    await loadTasks();
  }

  function exportTasks() {
    const exportRows = filteredTasks.map(task => ({
      ref: task.ref || `TASK-${task.id}`,
      customer: task.title || '',
      phone: task.customerPhone || '',
      vehicle: task.taskType || '',
      registration: task.assignedTo || '',
      service: task.note || '',
      status: task.status || 'open',
      updatedAt: `${task.dueDate || ''} ${task.dueTime || ''}`
    }));

    downloadCSV('tasks-followups-export.csv', exportRows);
  }

  function printTaskReport() {
    printCard('Tasks / Follow-ups Report', [
      ['Open Tasks', openCount],
      ['Due Today', todayCount],
      ['Overdue', overdueCount],
      ['Filtered Records', filteredTasks.length],
      ['Generated', new Date().toLocaleString()]
    ]);
  }

  return (
    <Page title="Tasks" sub="Follow-ups, reminders and daily admin tasks for the workshop.">
      <div className="task-kpis">
        <SpotlightCard className="task-kpi"><span>Open</span><strong>{openCount}</strong></SpotlightCard>
        <SpotlightCard className="task-kpi"><span>Today</span><strong>{todayCount}</strong></SpotlightCard>
        <SpotlightCard className="task-kpi danger"><span>Overdue</span><strong>{overdueCount}</strong></SpotlightCard>
      </div>

      <SpotlightCard className="panel-card">
        <div className="tasks-toolbar">
          <div className="filter-search">
            <span>Search Tasks</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, ref, phone, assignee, note..." />
          </div>

          <div className="filter-status">
            <span>View</span>
            <select value={view} onChange={e => setView(e.target.value)}>
              <option value="open">Open</option>
              <option value="today">Today</option>
              <option value="overdue">Overdue</option>
              <option value="done">Done</option>
              <option value="all">All</option>
            </select>
          </div>

          <strong>{filteredTasks.length} tasks</strong>
        </div>

        <div className="table-tools">
          <button className="primary" onClick={createGeneralTask}>Create Task</button>
          <button onClick={loadTasks}>{loading ? 'Refreshing...' : 'Refresh Tasks'}</button>
          <button onClick={remindAllDueToday}>Remind Due Today</button>
          <button onClick={exportTasks}>Export Tasks CSV</button>
          <button onClick={printTaskReport}>Print Task Report</button>
        </div>

        {loading ? (
          <EmptyState title="Loading tasks..." />
        ) : !filteredTasks.length ? (
          <EmptyState title="No tasks found" copy="Create follow-ups from here or from a job detail page." />
        ) : (
          <div className="tasks-list">
            {filteredTasks.map(task => (
              <div className={`task-record ${task.status === 'done' ? 'done' : ''} ${taskIsOverdue(task) ? 'overdue' : ''}`} key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  <small>{task.ref || 'No ref'} • {task.customerPhone || 'No phone'}</small>
                </div>

                <div>
                  <b>{task.dueDate || '-'}</b>
                  <small>{task.dueTime || 'No time'}</small>
                </div>

                <div>
                  <b>{task.assignedTo || 'Unassigned'}</b>
                  <small>{task.taskType || 'Task'}</small>
                </div>

                <Badge>{task.status || 'open'}</Badge>

                <div className="task-actions">
                  {task.customerPhone && <button onClick={() => remindCustomer(task)}><MessageCircle size={14} /> Customer</button>}
                  {task.assignedTo && <button onClick={() => remindTeam(task)}><MessageCircle size={14} /> Team</button>}
                  {task.status === 'done' ? (
                    <button onClick={() => setTaskStatus(task, 'open')}>Reopen</button>
                  ) : (
                    <button className="primary" onClick={() => setTaskStatus(task, 'done')}>Done</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SpotlightCard>

      <MadeBy />
    </Page>
  );
}


function docUrl(row) {
  return row?.url || row?.fileUrl || row?.pdfUrl || row?.downloadUrl || row?.path || row?.href || '';
}

function docType(row) {
  const text = `${row?.type || ''} ${row?.kind || ''} ${row?.name || ''} ${row?.filename || ''} ${docUrl(row)}`.toLowerCase();

  if (text.includes('pdf') || text.includes('claim')) return 'PDF / Claim';
  if (text.includes('licence') || text.includes('license')) return 'Licence';
  if (text.includes('id')) return 'ID';
  if (text.includes('damage') || text.includes('glass') || text.includes('photo') || text.includes('image') || text.includes('.jpg') || text.includes('.jpeg') || text.includes('.png')) return 'Photo';
  return row?.type || row?.kind || 'Document';
}

function isImageDoc(row) {
  const url = docUrl(row).toLowerCase();
  const text = `${row?.type || ''} ${row?.kind || ''}`.toLowerCase();
  return text.includes('image') || url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.png') || url.endsWith('.webp');
}

function DocumentsPage({ data, api, refreshTick = 0 }) {
  const [search, setSearch] = useState('');
  const [view, setView] = useState('all');
  const [selected, setSelected] = useState(null);
  const [liveDocs, setLiveDocs] = useState(data.documents || []);

  useEffect(() => {
    let alive = true;

    async function loadDocs() {
      try {
        if (!api) return;
        const result = await api('/documents');
        if (alive) setLiveDocs(result.documents || []);
      } catch {
        if (alive) setLiveDocs(data.documents || []);
      }
    }

    loadDocs();
    return () => { alive = false; };
  }, [api, data.documents, refreshTick]);

  const docs = (liveDocs || data.documents || []).map((doc, index) => ({
    ...doc,
    _id: doc.id || doc.ref || doc.url || doc.fileUrl || `DOC-${index + 1}`,
    _type: docType(doc),
    _url: docUrl(doc)
  }));

  const filteredDocs = docs
    .filter(row => {
      if (view === 'all') return true;
      if (view === 'photos') return row._type === 'Photo';
      if (view === 'pdfs') return row._type === 'PDF / Claim';
      if (view === 'ids') return row._type === 'ID' || row._type === 'Licence';
      return true;
    })
    .filter(row => matchesSearch(row, search));

  useEffect(() => {
    setSelected(current => {
      if (!filteredDocs.length) return null;
      if (!current) return filteredDocs[0];
      return filteredDocs.find(d => d._id === current._id) || filteredDocs[0];
    });
  }, [search, view, liveDocs, data.documents]);

  const photoCount = docs.filter(isImageDoc).length;
  const pdfCount = docs.filter(d => d._type === 'PDF / Claim').length;
  const idCount = docs.filter(d => d._type === 'ID' || d._type === 'Licence').length;

  function exportDocuments() {
    const exportRows = filteredDocs.map(row => ({
      ref: row.claimNo || row.jobNo || row.ref || row._id,
      customer: row.customerName || row.name || '',
      phone: row.customerPhone || row.phone || '',
      vehicle: row.vehicle || '',
      registration: row.registration || row.reg || '',
      service: row._type || '',
      status: row._url || '',
      updatedAt: row.createdAt || row.updatedAt || ''
    }));

    downloadCSV('documents-library-export.csv', exportRows);
  }

  function printDocumentSummary() {
    printCard('Documents Library Summary', [
      ['Total Documents', docs.length],
      ['Photos', photoCount],
      ['Claim PDFs', pdfCount],
      ['ID / Licence Docs', idCount],
      ['Filtered Records', filteredDocs.length],
      ['Generated', new Date().toLocaleString()]
    ]);
  }

  return (
    <Page title="Documents" sub="Search and manage uploaded customer photos, IDs, licences, claim PDFs and media files.">
      <div className="documents-summary">
        <SpotlightCard className="doc-mini-card">
          <span>Total Documents</span>
          <strong>{docs.length}</strong>
          <small>files captured</small>
        </SpotlightCard>
        <SpotlightCard className="doc-mini-card">
          <span>Photos</span>
          <strong>{photoCount}</strong>
          <small>images / uploads</small>
        </SpotlightCard>
        <SpotlightCard className="doc-mini-card">
          <span>Claim PDFs</span>
          <strong>{pdfCount}</strong>
          <small>generated forms</small>
        </SpotlightCard>
        <SpotlightCard className="doc-mini-card">
          <span>ID / Licence</span>
          <strong>{idCount}</strong>
          <small>verification docs</small>
        </SpotlightCard>
      </div>

      <div className="split">
        <SpotlightCard className="panel-card">
          <SectionHead title="Document Library" />

          <div className="documents-toolbar">
            <div className="filter-search">
              <span>Search Documents</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, phone, claim, vehicle, file type..." />
            </div>

            <div className="filter-status">
              <span>View</span>
              <select value={view} onChange={e => setView(e.target.value)}>
                <option value="all">All</option>
                <option value="photos">Photos</option>
                <option value="pdfs">Claim PDFs</option>
                <option value="ids">ID / Licence</option>
              </select>
            </div>

            <strong>{filteredDocs.length} files</strong>
          </div>

          <div className="table-tools">
            <button onClick={exportDocuments}>Export Documents CSV</button>
            <button onClick={printDocumentSummary}>Print Summary</button>
          </div>

          {!filteredDocs.length ? (
            <EmptyState title="No documents found" copy="Uploaded files from claims and customers will appear here." />
          ) : (
            <div className="documents-list">
              {filteredDocs.map(row => (
                <button key={row._id} onClick={() => setSelected(row)} className={selected?._id === row._id ? 'active' : ''}>
                  <div className="doc-icon">
                    <FileText size={18} />
                  </div>

                  <div>
                    <strong>{row.filename || row.name || row.title || row.claimNo || row.jobNo || 'Document'}</strong>
                    <small>{row.customerName || row.customerPhone || row.phone || 'Unknown customer'} • {row.claimNo || row.jobNo || row.ref || 'No ref'}</small>
                  </div>

                  <Badge>{row._type}</Badge>
                </button>
              ))}
            </div>
          )}
        </SpotlightCard>

        <SpotlightCard className="panel-card sticky">
          {!selected ? (
            <EmptyState title="No document selected" />
          ) : (
            <>
              <DetailHead label="Document" refNo={selected.claimNo || selected.jobNo || selected.ref || selected._id} status={selected._type} />

              <InfoGrid items={[
                ['Customer', selected.customerName || selected.name || '-'],
                ['Phone', selected.customerPhone || selected.phone || '-'],
                ['Claim No', selected.claimNo || '-'],
                ['Job No', selected.jobNo || '-'],
                ['Vehicle', selected.vehicle || '-'],
                ['Registration', selected.registration || selected.reg || '-'],
                ['File Type', selected._type],
                ['Created', selected.createdAt || '-']
              ]} />

              {selected._url ? (
                <div className="document-preview">
                  {isImageDoc(selected) ? (
                    <img src={vpSafeDashboardMediaUrl(selected._url)} alt="Document preview" />
                  ) : (
                    <div className="document-preview-box">
                      <FileText size={34} />
                      <strong>{selected.filename || selected.name || 'Document file'}</strong>
                      <small>{selected._type}</small>
                    </div>
                  )}

                  <div className="actions">
                    <a href={vpSafeDashboardMediaUrl(selected._url)} target="_blank" rel="noreferrer">Open Document <ExternalLink size={14} /></a>
                    <button onClick={() => navigator.clipboard?.writeText(selected._url).then(() => alert('Document link copied.'))}>Copy Link</button>
                  </div>
                </div>
              ) : (
                <EmptyState title="No document link available" />
              )}
            </>
          )}
        </SpotlightCard>
      </div>

      <MadeBy />
    </Page>
  );
}



function printCommercialDoc(title, rows, totals = []) {
  const tableRows = rows.map(([k, v]) => `
    <tr>
      <th>${vpEscapeHtml(k)}</th>
      <td>${vpEscapeHtml(v ?? '-')}</td>
    </tr>
  `).join('');

  const totalRows = totals.map(([k, v]) => `
    <div class="total-row">
      <span>${vpEscapeHtml(k)}</span>
      <strong>${vpEscapeHtml(v)}</strong>
    </div>
  `).join('');

  const html = `
    <!doctype html>
    <html>
      <head>
        <title>${vpEscapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 38px; color: #101828; }
          .top { display:flex; justify-content:space-between; gap:24px; border-bottom:4px solid #1268ff; padding-bottom:22px; margin-bottom:28px; }
          h1 { margin:0; font-size:34px; letter-spacing:-.03em; }
          h2 { margin:0 0 8px; font-size:15px; text-transform:uppercase; letter-spacing:.08em; color:#1268ff; }
          p { margin:5px 0; color:#667085; }
          .brand { text-align:right; }
          table { width:100%; border-collapse:collapse; margin-top:18px; }
          th, td { border:1px solid #d0d5dd; padding:13px; text-align:left; vertical-align:top; }
          th { width:34%; background:#f2f4f7; }
          .totals { margin-top:24px; margin-left:auto; width:340px; border:1px solid #d0d5dd; border-radius:12px; overflow:hidden; }
          .total-row { display:flex; justify-content:space-between; gap:16px; padding:13px 15px; border-bottom:1px solid #d0d5dd; }
          .total-row:last-child { border-bottom:0; background:#f2f4f7; }
          .footer { margin-top:42px; border-top:1px solid #d0d5dd; padding-top:14px; color:#667085; font-size:12px; }
          .sign { margin-top:48px; display:flex; gap:50px; }
          .sign div { flex:1; border-top:1px solid #98a2b3; padding-top:9px; color:#667085; font-size:12px; }
        </style>
      </head>
      <body>
        <div class="top">
          <div>
            <h2>Auto Glass Workshop</h2>
            <h1>${vpEscapeHtml(title)}</h1>
            <p>Generated: ${new Date().toLocaleString()}</p>
          </div>
          <div class="brand">
            <h2>VisionCo Dashboard</h2>
            <p>Windscreen Automation Dashboard</p>
            <p>Professional workshop document</p>
          </div>
        </div>

        <table>${tableRows}</table>

        ${totals.length ? `<div class="totals">${totalRows}</div>` : ''}

        <div class="sign">
          <div>Customer Signature</div>
          <div>Authorised Workshop Signature</div>
        </div>

        <div class="footer">
          This document was generated from the VisionCo Windscreen Automation Dashboard.
        </div>

        <script>window.print();</script>
      </body>
    </html>
  `;

  const w = window.open('', '_blank');
  if (!w) {
    alert('Popup blocked. Please allow popups for this dashboard.');
    return;
  }

  w.document.open();
  w.document.write(html);
  w.document.close();
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





// Calendar navigation is independent of the browser's local timezone.
function currentJobMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Africa/Harare', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return parts.find(p => p.type === 'year').value + '-' + parts.find(p => p.type === 'month').value;
}
function shiftJobMonth(month, delta) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7);
}
function jobMonthLabel(month) {
  return new Intl.DateTimeFormat('en', { timeZone: 'Africa/Harare', month: 'long', year: 'numeric' }).format(new Date(month + '-01T00:00:00+02:00'));
}
function MonthlyJobsPage({ api, reload, refreshTick = 0 }) {
  const [month, setMonth] = useState(currentJobMonth);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [exportBusy, setExportBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setError('');
    setResult(null);
    api('/jobs-by-month?month=' + encodeURIComponent(month)).then(value => {
      if (!cancelled) setResult(value);
    }).catch(() => {
      if (!cancelled) setError('Unable to load this month. Please retry.');
    });
    return () => { cancelled = true; };
  }, [month, revision]);
  useStudioRefreshPulse(refreshTick, () => {
    api('/jobs-by-month?month=' + encodeURIComponent(month))
      .then(value => setResult(value))
      .catch(() => {});
  });
  const ready = result?.month === month;
  async function refreshJobs() {
    await reload();
    setRevision(value => value + 1);
  }
  async function exportMonthlyPdf() {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      await vpDownloadStudioPdf(
        `/jobs-month-report.pdf?month=${encodeURIComponent(month)}`,
        `Windscreen-Job-Cards-${month}-Report.pdf`
      );
    } catch (error) {
      window.alert(error.message || 'Unable to export PDF report.');
    } finally {
      setExportBusy(false);
    }
  }
  return (
    <>
      <section className="job-month-control" aria-label="Monthly job performance">
        <div className="job-month-navigation">
          <button type="button" aria-label="Previous month" onClick={() => setMonth(value => shiftJobMonth(value, -1))}>‹</button>
          <strong>{jobMonthLabel(month)}</strong>
          <button type="button" aria-label="Next month" disabled={month >= currentJobMonth()} onClick={() => setMonth(value => shiftJobMonth(value, 1))}>›</button>
        </div>
        <div className="job-month-report-actions">
          <div className="job-month-total" aria-live="polite"><span>Job Count</span><strong>{ready ? result.jobs.length : '—'}</strong><small>Created in selected month · CAT</small></div>
          <button type="button" className="job-month-export" title="Export PDF statistics" onClick={exportMonthlyPdf} disabled={exportBusy || !ready}>
            <Download size={14} /> {exportBusy ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </section>
      {error ? <div role="alert" className="job-month-message">{error} <button type="button" onClick={() => setRevision(value => value + 1)}>Retry</button></div>
        : !ready ? <div role="status" className="job-month-message">Loading monthly jobs…</div>
        : <WorkPage title="Jobs" sub="Workshop jobs and work progress." rows={result.jobs} type="Job" api={api} reload={refreshJobs} />}
    </>
  );
}

function WorkPage({ title, sub, rows, type, api, reload, refreshTick = 0 }) {
  const [selected, setSelected] = useState(rows?.[0] || null);
  const [modalOpen, setModalOpen] = useState(false);
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [notesTick, setNotesTick] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');

  useEffect(() => {
    if (type !== 'Job') return;
    document.body.classList.add('vp-jobs-reference-native');
    document.body.classList.remove('vp-jobs-polish-active');
    return () => document.body.classList.remove('vp-jobs-reference-native');
  }, [type]);

  const endpoint = type === 'Booking' ? '/bookings' : type === 'Quote' ? '/quotes' : '/jobs';
  const action = type === 'Booking' ? 'Create Booking' : type === 'Quote' ? 'Create Quotation' : 'Create Job';

  const filteredRows = (rows || []).filter(r => matchesSearch(r, search) && matchesStatus(r, status));

  useEffect(() => {
    setSelected(current => {
      if (!filteredRows.length) return null;
      if (!current) return filteredRows[0];
      return filteredRows.find(r => r.jobNo === current.jobNo) || filteredRows[0];
    });
  }, [search, status, rows]);

  async function createRecord(form) {
    await api(endpoint, 'POST', form);
    setModalOpen(false);
    alert(`${type} saved successfully.`);
    await reload();
  }

  async function updateJob(status) {
    if (!selected?.jobNo) return;
    await api(`/jobs/${selected.jobNo}/status`, 'POST', { status });
    setNotesTick(x => x + 1);
    await reload();
  }

  async function addNote() {
    if (!selected?.jobNo) return;
    const note = prompt('Internal note:');
    if (!note) return;
    await api('/notes', 'POST', { ref: selected.jobNo, type: 'internal', note });
    setNotesTick(x => x + 1);
    alert('Note saved.');
    await reload();
  }

  async function workflow(action, value) {
    if (!selected?.jobNo) return;
    await api(`/jobs/${selected.jobNo}/workflow`, 'POST', { action, value });
    setNotesTick(x => x + 1);
    await reload();
  }

  async function setQuoteAmount() {
    const amount = prompt('Quote amount in USD:');
    if (!amount) return;
    await workflow('set_quote_amount', amount);
  }

  async function assignFitter() {
    const fitter = await chooseTeamFitter(api);
    if (!fitter) return;
    await workflow('assign_fitter', fitter);
  }

  async function sendCustomerUpdate(kind) {
    if (!selected?.customerPhone || !selected?.jobNo) {
      alert('No customer phone number found on this record.');
      return;
    }

    const name = selected.customerName || 'there';
    const vehicle = selected.vehicle || 'your vehicle';
    const service = selected.service || 'your auto glass service';
    const quoteAmount = selected?.quoteAmount || selected?.quote_amount || selected?.data?.quoteAmount;

    const templates = {
      booking: `Good day ${name}, your booking for ${service} on ${vehicle} has been received. Our team will keep you updated. Thank you.`,
      quote: `Good day ${name}, your quote for ${service} on ${vehicle}${quoteAmount ? ` is $${quoteAmount}` : ' is being prepared'}. Please reply if you would like to proceed.`,
      started: `Good day ${name}, work has started on ${vehicle}. We will update you once the job is complete.`,
      completed: `Good day ${name}, your ${service} for ${vehicle} has been completed. Thank you for choosing us.`,
      payment: `Good day ${name}, this is a payment reminder for your ${service} on ${vehicle}. Please let us know once payment has been made. Thank you.`
    };

    const msg = prompt('Edit WhatsApp message before sending:', templates[kind] || '');
    if (!msg) return;

    await api('/message', 'POST', { phone: selected.customerPhone, message: msg });
    await api('/notes', 'POST', { ref: selected.jobNo, type: 'whatsapp_update', note: `WhatsApp update sent: ${msg}` });
    setNotesTick(x => x + 1);
    alert('WhatsApp message sent.');
  }

  const quoteAmount = selected?.quoteAmount || selected?.quote_amount || selected?.data?.quoteAmount;
  const fitter = selected?.fitter || selected?.assignedTo || selected?.assigned_to || selected?.data?.fitter;
  const invoiceStatus = selected?.invoiceStatus || selected?.invoice_status || selected?.data?.invoiceStatus;
  const bookingDate = selected?.bookingDate || selected?.booking_date || selected?.data?.bookingDate;
  const bookingTime = selected?.bookingTime || selected?.booking_time || selected?.data?.bookingTime;
  const priority = selected?.priority || selected?.data?.priority;

  // VP_JOBS_WORKSHOP_FLOOR_V2
  const workStatus = row => String(row?.publicStatus || row?.status || '').toLowerCase();
  const jobsQuoteCount = type === 'Job' ? (rows || []).filter(row => workStatus(row).includes('quot')).length : 0;
  const jobsActiveCount = type === 'Job' ? (rows || []).filter(row => workStatus(row).includes('progress') || workStatus(row).includes('assigned')).length : 0;
  const jobsWaitingCount = type === 'Job' ? (rows || []).filter(row => workStatus(row).includes('waiting')).length : 0;
  const jobsCompletedCount = type === 'Job' ? (rows || []).filter(row => workStatus(row).includes('complete') || workStatus(row).includes('closed')).length : 0;

  const quoteRows = type === 'Quote' ? (rows || []) : [];
  const quoteAwaitingCount = quoteRows.filter(row => {
    const s = workStatus(row);
    return s.includes('quote stage') || s.includes('pending') || s.includes('awaiting quote');
  }).length;
  const quoteSentCount = quoteRows.filter(row => workStatus(row).includes('quotation sent') || workStatus(row).includes('quote_sent')).length;
  const quoteApprovedCount = quoteRows.filter(row => workStatus(row).includes('approved')).length;
  const quoteDeclinedCount = quoteRows.filter(row => workStatus(row).includes('declined')).length;
  const quoteTotalValue = quoteRows.reduce((sum, row) => {
    const value = Number(row?.quoteAmount || row?.quote_amount || row?.data?.quoteAmount || row?.data?.quoteGrandTotal || 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  const selectedHasSentQuote = Boolean(
    selected?.data?.lastQuoteNo ||
    String(selected?.publicStatus || selected?.status || '').toLowerCase().includes('sent')
  );

  function printJobCard() {
    if (!selected) return;
    printCard(`${type} Card - ${selected.ref || selected.jobNo}`, [
      ['Reference', selected.ref || selected.jobNo],
      ['Customer', selected.customerName],
      ['Phone', selected.customerPhone],
      ['Vehicle', selected.vehicle],
      ['Registration', selected.registration],
      ['Service', selected.service],
      ['Location', selected.location],
      ['Job Date', selected.jobDate || '-'],
      ['Job Time', selected.jobTime ? `${selected.jobTime} CAT` : '-'],
      ['Booking Date', bookingDate || '-'],
      ['Booking Time', bookingTime || '-'],
      ['Priority', priority || '-'],
      ['Quote Amount', quoteAmount ? `$${quoteAmount}` : '-'],
      ['Fitter', fitter || '-'],
      ['Invoice', invoiceStatus || '-'],
      ['Status', selected.publicStatus || selected.status]
    ]);
  }

  function printFormalQuote() {
    if (!selected) return;

    const amount = Number(quoteAmount || 0);

    printCommercialDoc(`Formal Quote - ${selected.ref || selected.jobNo}`, [
      ['Quote Ref', selected.ref || selected.jobNo],
      ['Customer', selected.customerName || '-'],
      ['Phone', selected.customerPhone || '-'],
      ['Vehicle', selected.vehicle || '-'],
      ['Registration', selected.registration || '-'],
      ['Service', selected.service || '-'],
      ['Location', selected.location || '-'],
      ['Booking Date', bookingDate || '-'],
      ['Booking Time', bookingTime || '-'],
      ['Technician / Fitter', fitter || '-'],
      ['Quote Status', selected.publicStatus || selected.status || '-'],
      ['Notes', selected.notes || selected.data?.notes || '-']
    ], [
      ['Quoted Amount', `$${amount.toFixed(2)}`],
      ['Validity', '7 days'],
      ['Total Due', `$${amount.toFixed(2)}`]
    ]);
  }

  function printInvoiceDoc() {
    if (!selected) return;

    const amount = Number(quoteAmount || 0);

    printCommercialDoc(`Invoice - ${selected.ref || selected.jobNo}`, [
      ['Invoice Ref', selected.ref || selected.jobNo],
      ['Customer', selected.customerName || '-'],
      ['Phone', selected.customerPhone || '-'],
      ['Vehicle', selected.vehicle || '-'],
      ['Registration', selected.registration || '-'],
      ['Service', selected.service || '-'],
      ['Location', selected.location || '-'],
      ['Technician / Fitter', fitter || '-'],
      ['Invoice Status', invoiceStatus || selected.publicStatus || selected.status || '-']
    ], [
      ['Subtotal', `$${amount.toFixed(2)}`],
      ['Paid / Status', invoiceStatus || '-'],
      ['Total', `$${amount.toFixed(2)}`]
    ]);
  }

  async function quotationSent(result) {
    setQuoteModalOpen(false);
    setNotesTick(x => x + 1);
    await reload();
    const q = result?.quotation;
    alert(q ? `Quotation ${q.quoteNo} sent to ${selected?.customerPhone || 'customer'}.` : 'Quotation sent to customer.');
  }

  async function sendInvoiceMessage() {
    if (!selected?.customerPhone) {
      alert('No customer phone number found on this record.');
      return;
    }

    const amount = Number(quoteAmount || 0);
    const msg = prompt(
      'Edit invoice/payment request before sending:',
      `Good day ${selected.customerName || 'there'}, your invoice for ${selected.service || 'the completed service'} on ${selected.vehicle || 'your vehicle'} is $${amount.toFixed(2)}. Please let us know once payment has been made. Thank you.`
    );

    if (!msg) return;

    await api('/message', 'POST', { phone: selected.customerPhone, message: msg });

    if (selected?.jobNo) {
      await api('/notes', 'POST', {
        ref: selected.jobNo,
        type: 'invoice_whatsapp',
        note: `Invoice/payment request sent: ${msg}`
      });
      setNotesTick(x => x + 1);
    }

    alert('Invoice message sent.');
  }

  const jobsReferenceInfo = type === 'Job' && selected ? [
    [UserCircle, 'Customer', selected.customerName || '-'],
    [Phone, 'Phone', selected.customerPhone || '-'],
    [Car, 'Vehicle', selected.vehicle || '-'],
    [FileText, 'Registration', selected.registration || '-'],
    [Wrench, 'Service', selected.service || '-'],
    [MapPin, 'Location', selected.location || '-'],
    [CalendarCheck, 'Job Date', selected.jobDate || '-'],
    [Activity, 'Job Time', selected.jobTime ? `${selected.jobTime} CAT` : '-']
  ] : [];

  return (
    <Page title={title} sub={sub}>
      {type === 'Job' && (
        <section className="jobs-floor-strip">
          <article className="quote"><i><FileText size={18}/></i><div><span>Quote Stage</span><strong>{jobsQuoteCount}</strong><small>awaiting approval / action</small></div></article>
          <article className="active"><i><Activity size={18}/></i><div><span>Active Work</span><strong>{jobsActiveCount}</strong><small>assigned or in progress</small></div></article>
          <article className="waiting"><i><AlertTriangle size={18}/></i><div><span>Waiting Parts</span><strong>{jobsWaitingCount}</strong><small>blocked by stock</small></div></article>
          <article className="complete"><i><CheckCircle2 size={18}/></i><div><span>Completed</span><strong>{jobsCompletedCount}</strong><small>finished / closed</small></div></article>
        </section>
      )}
      {type === 'Quote' && (
        <section className="jobs-floor-strip quotation-floor-strip">
          <article className="quote"><i><FileText size={18}/></i><div><span>Awaiting Quote</span><strong>{quoteAwaitingCount}</strong><small>needs pricing / review</small></div></article>
          <article className="active"><i><MessageCircle size={18}/></i><div><span>Sent</span><strong>{quoteSentCount}</strong><small>waiting for customer action</small></div></article>
          <article className="complete"><i><CheckCircle2 size={18}/></i><div><span>Approved</span><strong>{quoteApprovedCount}</strong><small>customer accepted</small></div></article>
          <article className="declined"><i><XCircle size={18}/></i><div><span>Declined</span><strong>{quoteDeclinedCount}</strong><small>customer declined</small></div></article>
          <article className="value"><i><FileText size={18}/></i><div><span>Quoted Value</span><strong>${quoteTotalValue.toFixed(2)}</strong><small>current quotation register</small></div></article>
        </section>
      )}
      <div className={cx('split', type === 'Job' && 'jobs-floor-grid')}>
        <SpotlightCard className={cx('panel-card', type === 'Job' && 'jobs-floor-list')}>
          <SectionHead title={title} action={action} onClick={() => setModalOpen(true)} />
          <FilterBar search={search} setSearch={setSearch} status={status} setStatus={setStatus} count={filteredRows.length} label={title.toLowerCase()} />
          <TableTools onExport={() => downloadCSV(`${title.toLowerCase()}-export.csv`, filteredRows)} />
          <RecordList rows={filteredRows} onSelect={setSelected} selected={selected} />
        </SpotlightCard>

        <SpotlightCard className={cx('panel-card sticky', type === 'Job' && 'jobs-floor-detail')}>
          {!selected ? (
            <EmptyState title={`No ${title.toLowerCase()} found`} copy="Try changing the search or status filter." />
          ) : (
            <>
              <DetailHead label={type} refNo={selected.ref || selected.jobNo} status={selected.publicStatus} />

              {(String(selected.publicStatus || '').toLowerCase().includes('quote') || type === 'Quote') && (
                <div className="vp-quote-stage-cta">
                  <div>
                    <strong>{selectedHasSentQuote ? 'Revise customer quotation' : 'Create customer quotation'}</strong>
                    <span>Generate the branded PDF, send it to WhatsApp, and give the customer Approve / Ask Question / Decline choices.</span>
                  </div>
                  <button className="primary vp-quote-customer-btn" onClick={() => setQuoteModalOpen(true)}>
                    <MessageCircle size={16} /> {selectedHasSentQuote ? 'Send Revised Quotation' : 'Create & Send Quotation'}
                  </button>
                </div>
              )}

              {type === 'Job' && (
                <div className="job-stage-banner">
                  <div><span>WORK STAGE</span><strong>{selected.publicStatus || selected.status || 'New'}</strong><small>{selected.service || 'Service to confirm'}</small></div>
                  <div><span>Quote</span><strong>{quoteAmount ? `$${quoteAmount}` : 'Not set'}</strong></div>
                  <div><span>Fitter</span><strong>{fitter || 'Unassigned'}</strong></div>
                  <div><span>Invoice</span><strong>{invoiceStatus || 'Not issued'}</strong></div>
                </div>
              )}

              {type === 'Job' ? (
                <div className="jobs-reference-info-grid">
                  {jobsReferenceInfo.map(([IconComp, label, value]) => (
                    <div className="jobs-reference-info-card" key={label}>
                      <span><IconComp size={22} /></span>
                      <div><small>{label}</small><strong>{String(value ?? '-')}</strong></div>
                    </div>
                  ))}
                </div>
              ) : (
                <InfoGrid items={[
                  ['Customer', selected.customerName],
                  ['Phone', selected.customerPhone],
                  ['Vehicle', selected.vehicle],
                  ['Registration', selected.registration],
                  ['Service', selected.service],
                  ['Location', selected.location],
                  ['Booking Date', bookingDate || '-'],
                  ['Booking Time', bookingTime || '-'],
                  ['Priority', priority || '-'],
                  ['Quote Amount', quoteAmount ? `$${quoteAmount}` : '-'],
                  ['Fitter', fitter || '-'],
                  ['Invoice', invoiceStatus || '-']
                ]} />
              )}

              {type === 'Quote' && selected?.jobNo && (
                <QuotationHistoryPanel jobNo={selected.jobNo} api={api} refreshTick={refreshTick + notesTick} />
              )}

              {selected.jobNo && (
                <>
                  <div className="workflow-panel">
                    <h3>Workflow Actions</h3>
                    <div className="actions">
                      <button className="primary" onClick={assignFitter}>Assign Fitter</button>
                      <button onClick={() => workflow('convert_to_job')}>Convert to Job</button>
                      <button onClick={() => workflow('invoice_sent')}>Invoice Sent</button>
                      <button onClick={() => workflow('paid')}>Mark Paid</button>
                      <button onClick={() => updateJob('in_progress')}>In Progress</button>
                      <button onClick={() => updateJob('completed')}>Completed</button>
                      <button onClick={() => updateJob('waiting_parts')}>Waiting Parts</button>
                      <button onClick={() => updateJob('closed')}>Closed</button>
                      <button onClick={printJobCard}>Print Job Card</button>
                      <button onClick={printFormalQuote}>Print Formal Quote</button>
                      <button onClick={printInvoiceDoc}>Print Invoice</button>
                      <button onClick={sendInvoiceMessage}><MessageCircle size={15} /> Send Invoice</button>
                      <button onClick={addNote}>Add Internal Note</button>
                    </div>
                  </div>

                  <div className="workflow-panel customer-updates-panel">
                    <h3>Customer WhatsApp Updates</h3>
                    <div className="actions">
                      <button className="primary" onClick={() => sendCustomerUpdate('booking')}><MessageCircle size={15} /> Booking Confirmation</button>
                      <button onClick={() => sendCustomerUpdate('started')}><MessageCircle size={15} /> Job Started</button>
                      <button onClick={() => sendCustomerUpdate('completed')}><MessageCircle size={15} /> Job Completed</button>
                      <button onClick={() => sendCustomerUpdate('payment')}><MessageCircle size={15} /> Payment Reminder</button>
                    </div>
                  </div>
                </>
              )}

              <JobPartsPanel api={api} selected={selected} reload={reload} refreshTick={refreshTick} />

              <PaymentPanel api={api} selected={selected} reload={reload} refreshTick={refreshTick} />

              <TaskPanel api={api} selected={selected} reload={reload} refreshTick={refreshTick} />

              <NotesTimeline api={api} refNo={selected.jobNo} refreshKey={notesTick} />
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

      {quoteModalOpen && selected?.jobNo && (
        <QuoteCustomerModal
          job={selected}
          api={api}
          onClose={() => setQuoteModalOpen(false)}
          onSent={quotationSent}
        />
      )}

      <MadeBy />
    </Page>
  );
}



function Claims({ data, api, reload }) {
  const rows = data.claims || [];

  useEffect(() => {
    document.body.classList.add('vp-claims-reference-native');
    document.body.classList.remove('vp-claims-polish-active', 'vp-force-claims-active', 'vp-claims-final-page');
    return () => document.body.classList.remove('vp-claims-reference-native');
  }, []);
  const allDocs = data.documents || [];
  const [selected, setSelected] = useState(rows[0] || null);
  const [note, setNote] = useState('');
  const [notesTick, setNotesTick] = useState(0);
  const [insuranceBusy, setInsuranceBusy] = useState(false);
  const [insuranceError, setInsuranceError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredRows = rows.filter(r => matchesSearch(r, search) && matchesStatus(r, statusFilter));

  useEffect(() => {
    if (!filteredRows.length) {
      if (selected) setSelected(null);
      return;
    }

    const current = filteredRows.find(r => r.claimNo === selected?.claimNo);
    if (current) {
      if (current !== selected) setSelected(current);
      return;
    }

    setSelected(filteredRows[0]);
  }, [search, statusFilter, rows, selected?.claimNo]);

  useEffect(() => {
    setInsuranceError('');
  }, [selected?.claimNo]);

  async function sendToInsurance() {
    if (!selected?.claimNo || insuranceBusy) return;
    const retry = selected?.insurerEmail?.state === 'failed';

    setInsuranceBusy(true);
    setInsuranceError('');
    try {
      await api(`/claims/${selected.claimNo}/send-insurer`, 'POST', { retry });
      await reload();
    } catch (error) {
      setInsuranceError(error?.message || 'Unable to submit this claim to the insurer.');
      try { await reload(); } catch (_) {}
    } finally {
      setInsuranceBusy(false);
    }
  }

  async function submitPOS() {
    if (!selected?.claimNo) return;
    await api(`/claims/${selected.claimNo}/submit-pos`, 'POST', {});
    await reload();
  }

  async function addClaimNote() {
    if (!selected?.claimNo) return;
    const internalNote = prompt('Internal claim note:');
    if (!internalNote) return;
    await api('/notes', 'POST', { ref: selected.claimNo, type: 'claim_note', note: internalNote });
    setNotesTick(x => x + 1);
    alert('Note saved.');
  }

  async function messageCustomer() {
    const msg = prompt('Message to customer:');
    if (!msg || !selected?.customerPhone) return;
    await api('/message', 'POST', { phone: selected.customerPhone, message: msg });
    alert('Message sent.');
  }

  function printClaimSummary() {
    if (!selected) return;
    printCard(`Claim Summary - ${selected.claimNo}`, [
      ['Claim No', selected.claimNo],
      ['Customer', selected.customerName],
      ['Phone', selected.customerPhone],
      ['Insurer', selected.insurer],
      ['Vehicle', selected.vehicle],
      ['Registration', selected.registration],
      ['POS Ref', selected.posRef || 'Not submitted'],
      ['Status', selected.publicStatus || selected.status]
    ]);
  }

  function Icon({ type }) {
    if (type === 'search') {
      return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>;
    }

    if (type === 'shield') {
      return <svg viewBox="0 0 24 24"><path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M9 12l2 2 4-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    }

    if (type === 'file') {
      return <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M14 2v6h6M8 13h8M8 17h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>;
    }

    if (type === 'car') {
      return <svg viewBox="0 0 24 24"><path d="M5 17h14l-1.5-6.5A3 3 0 0 0 14.6 8H9.4a3 3 0 0 0-2.9 2.5L5 17z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M7 17v2M17 17v2M7.5 13h9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>;
    }

    if (type === 'user') {
      return <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M4 21a8 8 0 0 1 16 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>;
    }

    if (type === 'phone') {
      return <svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.7 19.7 0 0 1 3 5.2 2 2 0 0 1 5 3h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8.8 10.7a16 16 0 0 0 4.5 4.5l1.3-1.3a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6A2 2 0 0 1 22 16.9z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    }

    return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M12 7v5l3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>;
  }

  function InfoTile({ icon, label, children }) {
    return (
      <div className="claims-real-info">
        <span><Icon type={icon} /></span>
        <div>
          <small>{label}</small>
          <strong>{children || '-'}</strong>
        </div>
      </div>
    );
  }

  const claimDocsRaw = selected ? allDocs.filter(d =>
    d.claimNo === selected.claimNo ||
    d.ref === selected.claimNo
  ) : [];

  const claimDocs = [];
  const claimDocSeen = new Set();

  for (const d of claimDocsRaw) {
    const key = [
      d.ref || d.claimNo || '',
      d.url || '',
      d.filename || '',
      d.type || '',
      d.mimeType || ''
    ].join('|');

    if (claimDocSeen.has(key)) continue;
    claimDocSeen.add(key);
    claimDocs.push(d);
  }

  const photos = claimDocs.filter(d =>
    String(d.mimeType || d.mime_type || d.type || d.filename || '').toLowerCase().match(/image|jpg|jpeg|png|webp/)
  );

  const documents = [
    ...(selected?.pdfUrl ? [{ filename: 'claim_form.pdf', url: selected.pdfUrl, type: 'PDF' }] : []),
    ...claimDocs.filter(d =>
      !String(d.mimeType || d.mime_type || d.type || d.filename || '').toLowerCase().match(/image|jpg|jpeg|png|webp/)
    )
  ];

  // VP_CLAIMS_PROCESSING_DESK_V2
  const claimStatusText = row => String(row?.publicStatus || row?.status || '').toLowerCase();
  const claimPendingCount = rows.filter(row => /new|pending/.test(claimStatusText(row))).length;
  const claimReviewCount = rows.filter(row => /review/.test(claimStatusText(row))).length;
  const claimSubmittedCount = rows.filter(row => /submitted|insurance|processing/.test(claimStatusText(row))).length;
  const claimApprovedCount = rows.filter(row => /approved/.test(claimStatusText(row))).length;

  return (
    <Page title="Insurance Claims" sub="Manage claim forms, insurance status and POS submission.">
      <section className="claims-processing-strip">
        <article className="pending"><i><FileText size={18}/></i><div><span>Pending</span><strong>{claimPendingCount}</strong><small>new claims</small></div></article>
        <article className="review"><i><AlertTriangle size={18}/></i><div><span>Needs Review</span><strong>{claimReviewCount}</strong><small>staff attention</small></div></article>
        <article className="submitted"><i><ExternalLink size={18}/></i><div><span>Submitted</span><strong>{claimSubmittedCount}</strong><small>with insurer / processing</small></div></article>
        <article className="approved"><i><ShieldCheck size={18}/></i><div><span>Approved</span><strong>{claimApprovedCount}</strong><small>ready to progress</small></div></article>
      </section>

      <div className="claims-real-page claims-processing-desk">
        <section className="claims-real-panel claims-real-list-panel">
          <div className="claims-real-head">
            <div>
              <span>Claim Queue</span>
              <h2>Claims</h2>
            </div>
            <b>{filteredRows.length} claims</b>
          </div>

          <div className="claims-real-filters">
            <label>
              <span>Search</span>
              <div className="claims-real-search">
                <Icon type="search" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search customer, phone, vehicle, ref..."
                />
              </div>
            </label>

            <label>
              <span>Status</span>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="submitted">Submitted</option>
                <option value="approved">Approved</option>
                <option value="review">Needs Review</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
          </div>

          <div className="claims-real-actions">
            <button type="button" onClick={() => downloadCSV('claims-export.csv', filteredRows)}><Download size={14} /> Export CSV</button>
          </div>

          {!filteredRows.length ? (
            <div className="claims-real-empty">
              <div><Icon type="file" /></div>
              <h3>No records yet</h3>
              <p>New insurance claims from WhatsApp will appear here automatically.</p>
            </div>
          ) : (
            <div className="claims-real-list">
              {filteredRows.map(row => {
                const active = row.claimNo === selected?.claimNo;

                return (
                  <button
                    type="button"
                    key={row.claimNo}
                    className={active ? 'active' : ''}
                    onClick={() => setSelected(row)}
                  >
                    <div className="claims-real-row-icon"><Icon type="shield" /></div>

                    <div>
                      <strong>{row.claimNo}</strong>
                      <span>{row.customerName || row.customerPhone || 'Customer'}</span>
                    </div>

                    <div>
                      <b>{row.vehicle || 'Vehicle to confirm'}</b>
                      <small>{row.registration || row.insurer || 'To confirm'}</small>
                    </div>

                    <em>{row.publicStatus || row.status || 'Pending'}</em>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="claims-real-panel claims-real-detail-panel">
          {!selected ? (
            <div className="claims-real-empty detail">
              <div><Icon type="file" /></div>
              <h3>No insurance claims found</h3>
              <p>Try changing the search or status filter.</p>
            </div>
          ) : (
            <>
              <div className="claims-real-detail-head">
                <div>
                  <span>Insurance Claim</span>
                  <h2>{selected.claimNo}</h2>
                </div>
                <em>{selected.publicStatus || selected.status || 'Pending'}</em>
              </div>

              <div className="claim-readiness-banner">
                <div className="claim-readiness-title"><span>CLAIM READINESS</span><strong>{selected.insurer || 'Insurer to confirm'}</strong><small>{selected.customerName || selected.customerPhone || 'Customer'}</small></div>
                <div><i className={photos.length ? 'ok' : ''}>{photos.length}</i><span>Photos</span></div>
                <div><i className={documents.length ? 'ok' : ''}>{documents.length}</i><span>Documents</span></div>
                <div><i className={selected.pdfUrl ? 'ok' : ''}>{selected.pdfUrl ? '✓' : '—'}</i><span>Claim PDF</span></div>
                <div><i className={selected.posRef ? 'ok' : ''}>{selected.posRef ? '✓' : '—'}</i><span>POS</span></div>
              </div>

              <div className="claims-real-info-grid">
                <InfoTile icon="user" label="Customer">{selected.customerName}</InfoTile>
                <InfoTile icon="phone" label="Phone">{selected.customerPhone}</InfoTile>
                <InfoTile icon="shield" label="Insurer">{selected.insurer}</InfoTile>
                <InfoTile icon="car" label="Vehicle">{selected.vehicle}</InfoTile>
                <InfoTile icon="file" label="Registration">{selected.registration}</InfoTile>
                <InfoTile icon="file" label="POS Ref">{selected.posRef || 'Not submitted'}</InfoTile>
              </div>

              <section className="claim-insurance-card">
                <div className="claim-insurance-head">
                  <div>
                    <span>INSURANCE INTEGRATION</span>
                    <h3>{selected.insurerEmail?.insurer || selected.insurer || 'Insurer to confirm'}</h3>
                  </div>
                  <em className={`claim-insurance-status state-${selected.insurerEmail?.state || 'not_ready'}`}>
                    {selected.insurerEmail?.statusLabel || 'Awaiting customer confirmation'}
                  </em>
                </div>

                <div className="claim-insurance-grid">
                  <div>
                    <span>Recipient</span>
                    <strong className="claim-insurance-recipient">
                      {selected.insurerEmail?.routeConfigured ? selected.insurerEmail?.recipient : 'Manual Processing'}
                    </strong>
                  </div>
                  <div>
                    <span>PDF attachment</span>
                    <strong>
                      {selected.insurerEmail?.pdfRequired === false
                        ? (selected.insurerEmail?.pdfReady ? 'Attached' : 'Optional (temporary)')
                        : (selected.insurerEmail?.pdfReady ? 'Final PDF ready' : 'Final PDF not ready')}
                    </strong>
                  </div>
                  <div>
                    <span>Last submission</span>
                    <strong>{selected.insurerEmail?.sentAt ? new Date(selected.insurerEmail.sentAt).toLocaleString() : 'Never'}</strong>
                  </div>
                  {selected.insurerEmail?.messageId && (
                    <div>
                      <span>Provider message ID</span>
                      <strong className="claim-insurance-message-id">{selected.insurerEmail.messageId}</strong>
                    </div>
                  )}
                  {selected.insurerEmail?.deliveryState && (
                    <div>
                      <span>Delivery state</span>
                      <strong>{selected.insurerEmail.deliveryState}</strong>
                    </div>
                  )}
                  {selected.insurerEmail?.replyStatus && (
                    <div>
                      <span>Insurer reply</span>
                      <strong>
                        {selected.insurerEmail.replyStatus === 'confirmed'
                          ? `Confirmed${selected.insurerEmail?.replyReceivedAt ? ` · ${new Date(selected.insurerEmail.replyReceivedAt).toLocaleString()}` : ''}`
                          : 'Needs review'}
                      </strong>
                    </div>
                  )}
                </div>

                <p className={`claim-insurance-message state-${selected.insurerEmail?.state || 'not_ready'}`}>
                  {insuranceError || selected.insurerEmail?.message || 'Ready for insurer submission.'}
                </p>

              </section>

              <div className="claims-real-media-grid">
                <div className="claims-real-media-box">
                  <div className="claims-real-media-title">
                    <span><Icon type="car" /></span>
                    <h3>Claim Photos</h3>
                  </div>

                  {!photos.length ? (
                    <div className="claims-real-upload-empty">No photos uploaded yet</div>
                  ) : (
                    <div className="claims-real-photo-grid">
                      {photos.map((photo, index) => (
                        <a key={photo.url || index} href={vpSafeDashboardMediaUrl(photo.url)} target="_blank" rel="noreferrer">
                          <img src={vpSafeDashboardMediaUrl(photo.url)} alt={photo.filename || `Claim photo ${index + 1}`} />
                          <span>{photo.filename || `Photo ${index + 1}`}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                <div className="claims-real-media-box">
                  <div className="claims-real-media-title">
                    <span><Icon type="file" /></span>
                    <h3>Claim Documents</h3>
                  </div>

                  {!documents.length ? (
                    <div className="claims-real-upload-empty">No documents uploaded yet</div>
                  ) : (
                    <div className="claims-real-doc-list">
                      {documents.map((doc, index) => (
                        <a key={doc.url || index} href={vpSafeDashboardMediaUrl(doc.url)} target="_blank" rel="noreferrer">
                          <b>{String(doc.filename || doc.name || '').toLowerCase().includes('.pdf') ? 'PDF' : 'FILE'}</b>
                          <span>{doc.filename || doc.name || `Document ${index + 1}`}</span>
                          <small>Open</small>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="claims-real-note-box">
                <h3>Customer / Internal Note</h3>
                <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Optional customer note..." />
              </div>

              <div className="claim-insurance-only-action">
                {(() => {
                  const integrationState = selected.insurerEmail?.state || '';
                  const isSending = insuranceBusy || integrationState === 'sending';
                  const isWaiting = integrationState === 'awaiting_decision' || integrationState === 'awaiting_reply';
                  const isAccepted = integrationState === 'accepted';
                  const isDeclined = integrationState === 'declined';
                  const isReplied = integrationState === 'confirmed';
                  const isLegacySent = !isWaiting && !isAccepted && !isDeclined && !isReplied && selected.insurerEmail?.emailStatus === 'sent';
                  const visualState = isSending
                    ? 'sending'
                    : isAccepted
                      ? 'accepted'
                      : isDeclined
                        ? 'declined'
                        : isReplied
                          ? 'replied'
                          : isWaiting
                            ? 'waiting'
                            : isLegacySent
                              ? 'sent'
                              : 'ready';
                  const buttonLabel = isSending
                    ? 'Sending to Insurance...'
                    : isAccepted
                      ? 'Accepted'
                      : isDeclined
                        ? 'Declined'
                        : isReplied
                          ? 'Insurance Replied'
                          : isWaiting
                            ? (integrationState === 'awaiting_decision' ? 'Waiting for Insurance Decision' : 'Waiting for Insurance Reply')
                            : isLegacySent
                              ? 'Sent to Insurance'
                              : 'Send to Insurance';
                  const StatusIcon = isDeclined
                    ? XCircle
                    : (isAccepted || isReplied)
                      ? CheckCircle2
                      : (isWaiting || isSending)
                        ? RefreshCw
                        : ShieldCheck;

                  return (
                    <>
                      <button
                        type="button"
                        className={`claim-insurance-only-button state-${visualState}`}
                        onClick={sendToInsurance}
                        disabled={
                          insuranceBusy ||
                          !selected.insurerEmail?.routeConfigured ||
                          integrationState === 'sending' ||
                          selected.insurerEmail?.emailStatus === 'sent' ||
                          (!selected.insurerEmail?.canSend && !selected.insurerEmail?.canRetry)
                        }
                      >
                        <span className="claim-insurance-button-icon"><StatusIcon size={18} strokeWidth={2.2} /></span>
                        <span className="claim-insurance-button-copy">
                          <strong>{buttonLabel}</strong>
                          {(isWaiting || isAccepted || isDeclined || isReplied) && (
                            <small>
                              {isAccepted
                                ? 'Accepted by insurer'
                                : isDeclined
                                  ? 'Declined by insurer'
                                  : isReplied
                                    ? 'Legacy reply detected automatically'
                                    : integrationState === 'awaiting_decision'
                                      ? 'Waiting for Accept or Decline'
                                      : 'Watching the insurer inbox for a legacy reply'}
                            </small>
                          )}
                        </span>
                      </button>

                      {(isWaiting || isAccepted || isDeclined || isReplied) && (
                        <div className={`claim-insurance-sync-note ${isAccepted ? 'accepted' : isDeclined ? 'declined' : isReplied ? 'replied' : 'waiting'}`}>
                          <i />
                          <span>
                            {isAccepted
                              ? 'Insurance accepted · dashboard is in sync'
                              : isDeclined
                                ? 'Insurance declined · dashboard is in sync'
                                : isReplied
                                  ? 'Legacy insurance reply received · dashboard is in sync'
                                  : 'Auto-checking every 10 seconds · no manual refresh needed'}
                          </span>
                        </div>
                      )}

                      {(isAccepted || isDeclined) && selected.insurerEmail?.decisionComment && (
                        <div className="claim-insurance-decision-comment">
                          <strong>Insurer comment / excess</strong>
                          <span>{selected.insurerEmail.decisionComment}</span>
                        </div>
                      )}

                      {isDeclined && (
                        <div className="claim-insurance-decline-reason">
                          <strong>Decline reason</strong>
                          <span>{selected.insurerEmail?.decisionReason || 'No reason provided.'}</span>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              <NotesTimeline api={api} refNo={selected.claimNo} refreshKey={notesTick} />
            </>
          )}
        </section>
      </div>

      <MadeBy />
    </Page>
  );
}


function Customers({ data, api, reload }) {
  const customers = data.customers || [];
  const [selected, setSelected] = useState(customers[0] || null);
  const [modalOpen, setModalOpen] = useState(false);
  const [notesTick, setNotesTick] = useState(0);
  const [search, setSearch] = useState('');

  const filteredCustomers = customers.filter(c => matchesSearch(c, search));

  useEffect(() => {
    setSelected(current => {
      if (!filteredCustomers.length) return null;
      if (!current) return filteredCustomers[0];
      return filteredCustomers.find(c => c.phone === current.phone) || filteredCustomers[0];
    });
  }, [search, customers]);

  const phone = selected?.phone;
  const claims = (data.claims || []).filter(x => x.customerPhone === phone);
  const jobs = (data.jobs || []).filter(x => x.customerPhone === phone);
  const docs = (data.documents || []).filter(x =>
    x.phone === phone ||
    claims.some(c => c.claimNo === x.claimNo) ||
    jobs.some(j => j.jobNo === x.jobNo)
  );

  // VP_CUSTOMER_CRM_WORKSPACE_V2
  const customerPhonesWithJobs = new Set((data.jobs || []).map(x => x.customerPhone).filter(Boolean));
  const customerPhonesWithClaims = new Set((data.claims || []).map(x => x.customerPhone).filter(Boolean));
  const customersWithJobs = customers.filter(c => customerPhonesWithJobs.has(c.phone)).length;
  const customersWithClaims = customers.filter(c => customerPhonesWithClaims.has(c.phone)).length;
  const whatsappReadyCustomers = customers.filter(c => String(c.phone || '').trim()).length;
  const customerInitials = String(selected?.name || selected?.phone || 'CU').trim().split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0]).join('').toUpperCase() || 'CU';

  async function createCustomer(form) {
    await api('/customers', 'POST', form);
    setModalOpen(false);
    alert('Customer saved successfully.');
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
    setNotesTick(x => x + 1);
    alert('Note saved.');
  }

  function printCustomerProfile() {
    if (!selected) return;
    printCard(`Customer Profile - ${selected.name || selected.phone}`, [
      ['Name', selected.name || '-'],
      ['Phone', selected.phone],
      ['Vehicle', selected.vehicle || '-'],
      ['Registration', selected.registration || '-'],
      ['Claims', claims.length],
      ['Jobs', jobs.length],
      ['Documents', docs.length]
    ]);
  }

  return (
    <Page title="Customers" sub="Click a customer to see their claims, jobs, images and documents.">
      <section className="customer-crm-strip">
        <article><i><Users size={18}/></i><div><span>Total Customers</span><strong>{customers.length}</strong><small>customer profiles</small></div></article>
        <article className="jobs"><i><BriefcaseBusiness size={18}/></i><div><span>With Jobs</span><strong>{customersWithJobs}</strong><small>workshop history</small></div></article>
        <article className="claims"><i><ShieldCheck size={18}/></i><div><span>With Claims</span><strong>{customersWithClaims}</strong><small>insurance history</small></div></article>
        <article className="whatsapp"><i><MessageCircle size={18}/></i><div><span>WhatsApp Ready</span><strong>{whatsappReadyCustomers}</strong><small>contactable customers</small></div></article>
      </section>
      <div className="split customer-crm-grid">
        <SpotlightCard className="panel-card customer-crm-list">
          <div className="customer-crm-list-head"><div><span>CUSTOMER DIRECTORY</span><h2>Customer List</h2><p>Search by name, phone, vehicle or registration.</p></div><button className="primary" onClick={() => setModalOpen(true)}>+ Add Customer</button></div>
          <CustomerFilterBar search={search} setSearch={setSearch} count={filteredCustomers.length} />
          <TableTools onExport={() => downloadCSV('customers-export.csv', filteredCustomers)} />
          <CustomerList rows={filteredCustomers} selected={selected} onSelect={setSelected} />
        </SpotlightCard>

        <SpotlightCard className="panel-card sticky customer-crm-detail">
          {!selected ? (
            <EmptyState title="No customer found" copy="Try another name, phone, vehicle or registration." />
          ) : (
            <>
              <div className="customer-profile-hero">
                <div className="customer-profile-avatar">{customerInitials}</div>
                <div className="customer-profile-identity"><span>CUSTOMER PROFILE</span><h2>{selected.name || 'Customer'}</h2><strong>{selected.phone || 'No phone'}</strong><small>{selected.vehicle || 'Vehicle to confirm'} · {selected.registration || 'Registration to confirm'}</small></div>
                <div className="customer-profile-stat"><span>Jobs</span><strong>{jobs.length}</strong></div>
                <div className="customer-profile-stat"><span>Claims</span><strong>{claims.length}</strong></div>
                <div className="customer-profile-stat"><span>Files</span><strong>{docs.length}</strong></div>
              </div>
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
                <button onClick={printCustomerProfile}>Print Customer Profile</button>
                <button onClick={addNote}>Add Internal Note</button>
              </div>

              <NotesTimeline api={api} refNo={phone} refreshKey={notesTick} />
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

function DocumentsBlock({ docs }) {
  return (
    <div className="mini">
      <h3>Images & Documents</h3>
      {!docs.length ? (
        <EmptyState title="No documents for this customer" copy="Uploaded IDs, licences, PDFs and photos will show here." />
      ) : (
        <div className="docs-grid">
          {docs.map(d => (
            <a key={d.id} href={vpSafeDashboardMediaUrl(d.url)} target="_blank" rel="noreferrer">
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

function WifiSettingsSetupGuide() {
  return (
    <section className="settings-wifi-system">
      <details className="wifi-setup-guide">
        <summary><span><Wifi size={17}/> WiFi Voucher System Setup Guide</span><span>Reception desktop installation & maintenance</span></summary>
        <div className="wifi-setup-guide-content">
          <div className="wifi-setup-step">
            <strong>1. Install the Reception WiFi service</strong>
            <p>Install the approved Windows WiFi service on the reception desktop and leave it installed. This computer must keep its guest-network WiFi adapter connected.</p>
            <a href="https://www.mypublicwifi.com/" target="_blank" rel="noopener noreferrer">Open WiFi service download</a>
          </div>
          <div className="wifi-setup-step">
            <strong>2. Run Windscreen Reception Setup</strong>
            <p>This installs the Windscreen connector, pairing gateway and included runtime for the signed-in reception Windows user.</p>
            <a href="/files/downloads/Install-Windscreen-Reception-WiFi-Portable-v3.cmd" download>Download Reception Setup</a>
          </div>
          <div className="wifi-setup-step">
            <strong>3. Configure the guest network once</strong>
            <p>Use Router/NAT mode, automatic internet source, SSID <b>Windscreen Guest Wifi</b>, network key <b>windscreen</b>, and voucher-code authentication. Save the configuration.</p>
          </div>
          <div className="wifi-setup-step">
            <strong>4. Pair the dashboard</strong>
            <p>Reception Setup shows a six-digit pairing code. Open WiFi Vouchers and pair this browser once. Keep the pairing code on the reception computer only.</p>
          </div>
          <div className="wifi-setup-step">
            <strong>5. Apply the latest voucher rules</strong>
            <p>Run this update on reception computers already installed before this release. It keeps the existing pairing and changes unused voucher activation validity to 5 minutes.</p>
            <a href="/files/downloads/Update-Windscreen-WiFi-Connector-v5.cmd" download>Update WiFi Voucher Engine</a>
          </div>
          <div className="wifi-setup-step">
            <strong>6. Final acceptance test</strong>
            <p>Generate a 5-minute / 250 MB voucher. Confirm it appears under Live, activates on a phone, updates remaining time/data, and moves to History after completion. An unused voucher must expire after 5 minutes and move to History.</p>
          </div>
        </div>
        <p className="wifi-setup-footnote">Daily staff use stays simple: open WiFi Vouchers, generate a code, print or copy it, and monitor the Live section. Setup controls remain here in Settings.</p>
      </details>
    </section>
  );
}

function Settings({ data, api, reload, logout, theme, setTheme, autoRefreshEnabled, setAutoRefreshEnabled, lastRefreshAt }) {
  const posConnected = Boolean(data.config?.posConnected);
  return (
    <Page title="Settings" sub="Business, appearance and system controls.">
      <section className="settings-system-banner">
        <div className="settings-system-icon"><SettingsIcon size={22}/></div>
        <div><span>SYSTEM CONTROL CENTRE</span><h2>{data.config?.business || 'Windscreen Fitment Centre'}</h2><p>Core business identity, integrations and dashboard preferences.</p></div>
        <div className="settings-system-state"><i className={posConnected ? 'online' : ''}/><span>POS Integration</span><strong>{posConnected ? 'Connected' : 'Not connected'}</strong></div>
        <div className="settings-system-state"><i className="online"/><span>Production Data</span><strong>Protected</strong></div>
      </section>

      <div className="settings-grid settings-control-grid">
        <SpotlightCard className="panel-card settings-control-card identity">
          <div className="settings-card-head"><i><BriefcaseBusiness size={18}/></i><div><span>BUSINESS IDENTITY</span><h2>Business Details</h2><p>Identity used across workshop documents and automation.</p></div></div>
          <InfoGrid one items={[
            ['Business', data.config?.business],
            ['Base URL', data.config?.baseUrl]
          ]} />
        </SpotlightCard>

        <SpotlightCard className="panel-card settings-control-card integration">
          <div className="settings-card-head"><i><ExternalLink size={18}/></i><div><span>CONNECTED SYSTEM</span><h2>POS Integration</h2><p>Current shop and terminal connection details.</p></div></div>
          <InfoGrid one items={[
            ['POS Connected', posConnected ? 'Yes' : 'No'],
            ['Shop', data.config?.shopName || '-'],
            ['Terminal', data.config?.terminalName || '-']
          ]} />
          <div className={cx('settings-connection-pill', posConnected && 'online')}><i/>{posConnected ? 'Integration available' : 'Integration not connected'}</div>
        </SpotlightCard>

        <SpotlightCard className="panel-card settings-control-card appearance">
          <div className="settings-card-head"><i><Sun size={18}/></i><div><span>WORKSPACE</span><h2>Appearance</h2><p>Choose the dashboard presentation used by staff.</p></div></div>
          <div className="settings-theme-picker">
            <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}><span><Sun size={18}/></span><b>Light</b><small>Clean workshop view</small></button>
            <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}><span><Moon size={18}/></span><b>Dark</b><small>Reduced-light view</small></button>
          </div>
        </SpotlightCard>

        <SpotlightCard className="panel-card settings-control-card auto-refresh">
          <div className="settings-card-head"><i><RefreshCw size={18}/></i><div><span>LIVE DATA</span><h2>Automatic Refresh</h2><p>Keep every dashboard tab up to date without reloading the page.</p></div></div>
          <div className="settings-auto-refresh-row">
            <div><b>Refresh every 1 minute</b><small>Updates data quietly while keeping the current tab, filters, selected record and unsaved edits in place.</small></div>
            <button
              type="button"
              className={cx('settings-auto-refresh-toggle', autoRefreshEnabled && 'active')}
              role="switch"
              aria-checked={autoRefreshEnabled}
              onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
            >
              <span />
              <strong>{autoRefreshEnabled ? 'On' : 'Off'}</strong>
            </button>
          </div>
          <div className={cx('settings-refresh-status', autoRefreshEnabled && 'active')}>
            <i />
            <span>{autoRefreshEnabled ? 'Active every 1 minute on every tab' : 'Automatic refresh paused'}</span>
            <small>{lastRefreshAt ? `Last sync ${new Date(lastRefreshAt).toLocaleTimeString()}` : 'Waiting for first sync'}</small>
          </div>
        </SpotlightCard>

        <SpotlightCard className="panel-card settings-control-card protection">
          <div className="settings-card-head"><i><ShieldCheck size={18}/></i><div><span>PRODUCTION SAFETY</span><h2>Data Protection</h2><p>Safeguards for customer and workshop records.</p></div></div>
          <div className="settings-protection-list">
            <div><i>✓</i><span><b>Production records protected</b><small>Customer records are retained during dashboard changes.</small></span></div>
            <div><i>✓</i><span><b>Bulk reset disabled</b><small>No mass dashboard reset is exposed to staff.</small></span></div>
            <div><i>✓</i><span><b>Secure administrator access</b><small>The Studio remains behind the administrator PIN.</small></span></div>
          </div>
        </SpotlightCard>

        <SpotlightCard className="panel-card settings-account-card">
          <div><span>ADMINISTRATOR SESSION</span><h2>Account & Session</h2><p>End the current Studio session on this browser.</p></div>
          <button type="button" onClick={logout}><LogOut size={15}/> Sign out of Studio</button>
        </SpotlightCard>
      </div>

      <WifiSettingsSetupGuide />
      <footer className="settings-ownership-footer">
        <span>© {new Date().getFullYear()} Windscreen Fitment Centre. All rights reserved.</span>
        <span>Designed and Maintained by <a href="https://visionpixels.autos" target="_blank" rel="noopener noreferrer">VisionCo</a></span>
      </footer>
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


function PhoenixDashboard({ data = {}, setTab }) {
  const [botOnline, setBotOnline] = useState(null);

  useEffect(() => {
    let alive = true;

    async function checkBot() {
      try {
        const res = await fetch('/health', { cache: 'no-store' });
        const json = await res.json();
        if (alive) setBotOnline(Boolean(json?.ok && json?.ycloudConfigured));
      } catch {
        if (alive) setBotOnline(false);
      }
    }

    checkBot();
    const timer = setInterval(checkBot, 30000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const bookings = data.bookings || [];
  const claims = data.claims || data.insuranceClaims || [];
  const customers = data.customers || [];

  const latestBookings = bookings.slice(0, 5);
  const latestClaims = claims.slice(0, 5);
  const latestCustomers = customers.slice(0, 6);

  const botLabel = botOnline === null ? 'Checking' : botOnline ? 'Online' : 'Offline';

  return (
    <div className="phoenix-dashboard">
      <div className="phoenix-topbar">
        <div>
          <span className="phoenix-kicker">WINDSCREEN AUTOMATION</span>
          <h1>Control Centre</h1>
          <p>Live WhatsApp booking and insurance claim overview.</p>
        </div>

        <div className={`phoenix-bot-chip ${botOnline ? 'online' : botOnline === false ? 'offline' : 'checking'}`}>
          <span></span>
          WhatsApp Bot: {botLabel}
        </div>
      </div>

      <div className="phoenix-grid">
        <section className="phoenix-hero-card bookings">
          <div className="phoenix-card-head">
            <span>BOOKINGS</span>
            <button onClick={() => setTab?.('bookings')}>Open</button>
          </div>

          <div className="phoenix-big-number">{bookings.length}</div>
          <p>Customer bookings captured from WhatsApp and manual dashboard entries.</p>

          <div className="phoenix-energy-line">
            <i></i>
            <b></b>
            <i></i>
          </div>

          <div className="phoenix-mini-list">
            {latestBookings.length ? latestBookings.map((b, i) => (
              <div key={b.jobNo || b.ref || i}>
                <strong>{b.customerName || b.name || 'Customer'}</strong>
                <span>{b.vehicle || 'Vehicle to confirm'} • {b.service || 'Service to confirm'}</span>
              </div>
            )) : (
              <div className="phoenix-empty">No bookings yet</div>
            )}
          </div>
        </section>

        <section className="phoenix-status-card">
          <div className="phoenix-status-orb">
            <div className={botOnline ? 'pulse online' : botOnline === false ? 'pulse offline' : 'pulse checking'}></div>
            <strong>{botLabel}</strong>
            <span>WhatsApp Bot</span>
          </div>

          <div className="phoenix-system-lines">
            <div><span>Webhook</span><b>{botOnline ? 'ACTIVE' : botOnline === false ? 'OFFLINE' : 'CHECKING'}</b></div>
            <div><span>YCloud</span><b>{botOnline ? 'CONNECTED' : botOnline === false ? 'CHECK' : '...'}</b></div>
            <div><span>Dashboard Sync</span><b>LIVE</b></div>
          </div>
        </section>

        <section className="phoenix-claim-card">
          <div className="phoenix-card-head">
            <span>INSURANCE CLAIMS</span>
            <button onClick={() => setTab?.('claims')}>Open</button>
          </div>

          <div className="phoenix-big-number">{claims.length}</div>
          <p>Claims submitted through the automation and claim form process.</p>

          <div className="phoenix-claim-meter">
            <div style={{ width: `${Math.min(100, Math.max(8, claims.length * 18))}%` }}></div>
          </div>

          <div className="phoenix-mini-list">
            {latestClaims.length ? latestClaims.map((c, i) => (
              <div key={c.claimNo || c.ref || i}>
                <strong>{c.claimNo || c.ref || 'Claim'}</strong>
                <span>{c.customerName || c.name || 'Customer'} • {c.vehicle || 'Vehicle to confirm'}</span>
              </div>
            )) : (
              <div className="phoenix-empty">No insurance claims yet</div>
            )}
          </div>
        </section>

        <section className="phoenix-list-card latest-claims">
          <div className="phoenix-card-head">
            <span>LATEST INSURANCE CLAIMS</span>
            <button onClick={() => setTab?.('claims')}>View All</button>
          </div>

          <div className="phoenix-table">
            {latestClaims.length ? latestClaims.map((c, i) => (
              <div key={c.claimNo || c.ref || i}>
                <b>{c.claimNo || c.ref || 'Claim'}</b>
                <span>{c.customerName || c.name || 'Customer'}</span>
                <em>{c.status || c.publicStatus || 'Pending'}</em>
              </div>
            )) : (
              <div className="phoenix-empty large">No insurance claims yet</div>
            )}
          </div>
        </section>

        <section className="phoenix-list-card latest-customers">
          <div className="phoenix-card-head">
            <span>LATEST CUSTOMERS</span>
            <button onClick={() => setTab?.('customers')}>View All</button>
          </div>

          <div className="phoenix-customer-grid">
            {latestCustomers.length ? latestCustomers.map((c, i) => (
              <div key={c.id || c.phone || i}>
                <strong>{c.customerName || c.name || 'Customer'}</strong>
                <span>{c.phone || c.customerPhone || 'No phone'}</span>
                <b>{c.vehicle || 'Vehicle to confirm'}</b>
              </div>
            )) : (
              <div className="phoenix-empty large">No customers yet</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}


function ExactCustomerDashboard({ data = {}, setActive }) {
  const [botOnline, setBotOnline] = useState(null);

  useEffect(() => {
    let alive = true;

    async function checkBot() {
      try {
        const res = await fetch('/health', { cache: 'no-store' });
        const json = await res.json();
        if (alive) setBotOnline(Boolean(json?.ok && json?.ycloudConfigured));
      } catch {
        if (alive) setBotOnline(false);
      }
    }

    checkBot();
    const timer = setInterval(checkBot, 30000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const bookings = data.bookings || [];
  const claims = data.claims || data.insuranceClaims || [];
  const customers = data.customers || [];

  const latestClaims = claims.slice(0, 5);
  const latestCustomers = customers.slice(0, 5);

  const initials = (name) => {
    const clean = String(name || 'Customer').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (!parts.length) return 'CU';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  };

  const botIsOnline = botOnline === true;

  return (
    <div className="exact-dashboard">
      <div className="exact-page-head">
        <h1>Dashboard</h1>
        <p>An overview of your key activity.</p>
      </div>

      <div className="exact-kpi-grid">
        <div className="exact-kpi-card">
          <div className="exact-kpi-icon blue">
            <svg viewBox="0 0 24 24"><path d="M7 3v3M17 3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="M8 13h3v3H8z"/></svg>
          </div>
          <div>
            <span>Bookings</span>
            <strong>{bookings.length}</strong>
            <p>Normal customer bookings</p>
            <div className="exact-trend"><b>Today</b><em>Live</em></div>
          </div>
        </div>

        <div className="exact-kpi-card">
          <div className="exact-kpi-icon blue">
            <svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 5 3.5 8.5 7 10 3.5-1.5 7-5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-5"/></svg>
          </div>
          <div>
            <span>Insurance Claims</span>
            <strong>{claims.length}</strong>
            <p>Pending claims</p>
            <div className="exact-trend"><b>Pending</b><em>Live</em></div>
          </div>
        </div>

        <div className="exact-kpi-card exact-whatsapp-card">
          <div className="exact-whatsapp-icon">
            <svg viewBox="0 0 32 32"><path d="M16 3C9.38 3 4 8.38 4 15c0 2.26.63 4.38 1.73 6.18L4 29l8.05-1.66A11.87 11.87 0 0 0 16 28c6.62 0 12-5.38 12-12S22.62 3 16 3Z"/><path d="M11.7 9.9c-.3-.7-.6-.7-.9-.7h-.8c-.3 0-.8.1-1.2.6-.4.5-1.5 1.5-1.5 3.6s1.6 4.2 1.8 4.5c.2.3 3.1 5 7.7 6.8 3.8 1.5 4.6 1.2 5.4 1.1.8-.1 2.7-1.1 3.1-2.2.4-1.1.4-2 .3-2.2-.1-.2-.4-.3-.8-.5l-2.8-1.4c-.4-.2-.7-.2-1 .2-.3.4-1.1 1.4-1.4 1.7-.2.3-.5.3-.9.1-.4-.2-1.8-.7-3.4-2.1-1.3-1.1-2.1-2.5-2.4-2.9-.2-.4 0-.6.2-.8.2-.2.4-.5.6-.7.2-.2.3-.4.4-.7.1-.3.1-.5 0-.7l-1.3-3.1Z"/></svg>
          </div>
          <div>
            <span>WhatsApp Bot Status</span>
            <div className={`exact-status-pill ${botIsOnline ? 'online' : 'offline'}`}>
              <i></i>{botOnline === null ? 'Checking' : botIsOnline ? 'Online' : 'Offline'}
            </div>
            <p>{botIsOnline ? 'Bot is active and responding' : botOnline === null ? 'Checking bot connection' : 'Bot needs attention'}</p>
          </div>
        </div>
      </div>

      <div className="exact-lower-grid">
        <section className="exact-panel">
          <div className="exact-panel-head">
            <h2>Latest Insurance Claims</h2>
          </div>

          <div className="exact-claim-table">
            <div className="exact-table-header">
              <span>REF</span>
              <span>CUSTOMER</span>
              <span>VEHICLE</span>
              <span>STATUS</span>
            </div>

            {latestClaims.length ? latestClaims.map((claim, i) => (
              <div className="exact-table-row" key={claim.claimNo || claim.ref || i}>
                <span>{claim.claimNo || claim.ref || `CLM-${String(i + 1).padStart(4, '0')}`}</span>
                <b>{claim.customerName || claim.name || 'Customer'}</b>
                <span>{claim.vehicle || 'Vehicle to confirm'}</span>
                <em className={String(claim.status || '').toLowerCase().includes('approved') ? 'approved' : 'pending'}>
                  <i></i>{claim.status || claim.publicStatus || 'Pending'}
                </em>
              </div>
            )) : (
              <div className="exact-empty-row">No insurance claims yet</div>
            )}
          </div>

          <button className="exact-link-btn" onClick={() => setActive?.('claims')}>View all claims <span>›</span></button>
        </section>

        <section className="exact-panel">
          <div className="exact-panel-head">
            <h2>Latest Customers</h2>
          </div>

          <div className="exact-customer-list">
            {latestCustomers.length ? latestCustomers.map((customer, i) => (
              <button className="exact-customer-row" key={customer.id || customer.phone || i} onClick={() => setActive?.('customers')}>
                <div className={`exact-avatar tone-${i % 5}`}>{initials(customer.customerName || customer.name)}</div>
                <div>
                  <b>{customer.customerName || customer.name || 'Customer'}</b>
                  <span>{customer.phone || customer.customerPhone || 'No phone'}</span>
                </div>
                <div>
                  <strong>{customer.vehicle || 'Vehicle to confirm'}</strong>
                  <span>Reg: {customer.registration || customer.regNo || customer.reg || 'To confirm'}</span>
                </div>
                <i>›</i>
              </button>
            )) : (
              <div className="exact-empty-row">No customers yet</div>
            )}
          </div>

          <button className="exact-link-btn" onClick={() => setActive?.('customers')}>View all customers <span>›</span></button>
        </section>
      </div>
    </div>
  );
}


const BOOKINGS_PREVIEW_CSS_EXACT = "\n:root{\n  --bg:#f5f8fc;--surface:#fff;--ink:#08142f;--text:#243652;--muted:#7888a2;--line:#dfe7f1;\n  --blue:#0b6cf2;--blue2:#0758da;--blue-soft:#edf5ff;--violet:#7650df;--violet-soft:#f3edff;\n  --amber:#d88405;--amber-soft:#fff4df;--green:#0da86f;--green-soft:#e8f8f0;--shadow:0 18px 46px rgba(31,59,96,.07)\n}\n*{box-sizing:border-box}\nhtml,body{margin:0;min-height:100%;background:var(--bg);color:var(--ink)}\nbody{font-family:\"Manrope\",sans-serif;-webkit-font-smoothing:antialiased}\nbutton,input,select{font:inherit}\nbutton{cursor:pointer}\nsvg{display:block}\n.page{min-height:100vh;background:linear-gradient(180deg,#fbfdff 0%,#f5f8fc 38%,#f5f8fc 100%)}\n.wrap{width:min(1760px,calc(100% - 56px));margin:0 auto;padding-bottom:34px}\n.brandbar{height:82px;display:flex;align-items:center;justify-content:space-between;gap:24px}\n.brand{display:flex;align-items:center;gap:14px}.brand img{width:42px;height:42px;object-fit:contain}.brand-copy{display:flex;flex-direction:column;line-height:1.05}.brand-copy strong{font-family:\"Sora\",sans-serif;font-size:18px;letter-spacing:-.45px}.brand-copy span{margin-top:5px;font-size:11px;color:#6d7e98;letter-spacing:.1px}\n.brand-right{display:flex;align-items:center;gap:20px}.online{display:flex;align-items:center;gap:9px;padding:9px 13px;border:1px solid #d7eadf;border-radius:999px;background:#f8fcfa;color:#2d6752;font-size:11px;font-weight:700}.dot{width:9px;height:9px;border-radius:50%;background:#14b877;box-shadow:0 0 0 5px rgba(20,184,119,.11)}.date{padding-left:20px;border-left:1px solid #dce4ee;color:#5d6e88}.date strong{display:block;font-family:\"Space Grotesk\",sans-serif;font-size:11px}.date span{display:block;margin-top:4px;font-size:10px;color:#8b98aa}\n.hero{position:relative;min-height:184px;display:grid;grid-template-columns:minmax(0,1.1fr) auto;align-items:center;gap:28px;padding:18px 10px 24px;overflow:hidden;isolation:isolate}\n.hero:before{content:\"\";position:absolute;inset:-35px -55px -56px 38%;z-index:-2;background:url('/files/renovation/dashboard-v1/assets/hero-windscreen.webp?v=bookings-v1') center right/cover no-repeat;opacity:.87;transform:scale(1.045);filter:saturate(.94) contrast(1.01)}\n.hero:after{content:\"\";position:absolute;inset:0;z-index:-1;background:\n linear-gradient(180deg,rgba(245,248,252,0) 0%,rgba(245,248,252,.04) 48%,rgba(245,248,252,.56) 78%,rgba(245,248,252,1) 100%),\n linear-gradient(90deg,#fbfdff 0%,rgba(251,253,255,.99) 22%,rgba(251,253,255,.90) 35%,rgba(251,253,255,.54) 48%,rgba(251,253,255,.14) 62%,rgba(245,248,252,.04) 80%,rgba(245,248,252,.52) 95%,#f5f8fc 100%)}\n.eyebrow{font-family:\"Space Grotesk\",sans-serif;text-transform:uppercase;letter-spacing:2px;font-size:11px;font-weight:700;color:var(--blue)}\n.hero h1{margin:8px 0 6px;font-family:\"Sora\",sans-serif;font-size:58px;line-height:.98;letter-spacing:-3px;font-weight:800;color:#07132f}.hero p{margin:0;color:#71809b;font-size:15px;line-height:1.55;font-weight:500;max-width:690px}\n.hero-aside{display:flex;align-items:center;gap:28px;margin-right:8px}.tagline{font-family:\"Space Grotesk\",sans-serif;color:#4f6282;font-size:17px;line-height:1.35;max-width:175px}.tagline:before{content:\"\";display:block;width:34px;height:3px;border-radius:9px;background:#2875ec;margin-bottom:11px}.create{height:58px;padding:0 30px;border:0;border-radius:14px;background:linear-gradient(135deg,#1172f6,#0757d9);color:#fff;display:flex;align-items:center;gap:12px;font-family:\"Space Grotesk\",sans-serif;font-size:13px;font-weight:700;box-shadow:0 15px 30px rgba(11,108,242,.2)}.create:hover{transform:translateY(-1px)}\n.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;margin-top:2px}.stat{min-height:124px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.97);box-shadow:0 12px 28px rgba(31,59,96,.04);display:grid;grid-template-columns:60px 1fr;align-items:center;gap:16px;padding:18px 22px}.stat-icon{width:60px;height:60px;border-radius:17px;display:grid;place-items:center}.stat-icon svg{width:29px;height:29px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.sblue{background:#eaf4ff;color:#0966ec}.sviolet{background:var(--violet-soft);color:var(--violet)}.samber{background:var(--amber-soft);color:var(--amber)}.sgreen{background:var(--green-soft);color:var(--green)}\n.stat label{display:block;font-family:\"Space Grotesk\",sans-serif;font-size:12px;font-weight:700;color:#65758f}.stat strong{display:block;margin-top:5px;font-family:\"Sora\",sans-serif;font-size:34px;letter-spacing:-1.2px;line-height:1}.stat small{display:block;margin-top:7px;font-size:11px;color:#8190a8}\n.workspace{display:grid;grid-template-columns:minmax(0,1.02fr) minmax(580px,.98fr);gap:18px;margin-top:20px}.panel{background:rgba(255,255,255,.98);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow);overflow:hidden}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:24px 27px 15px}.panel-kicker{font-family:\"Space Grotesk\",sans-serif;font-size:10px;font-weight:700;letter-spacing:1.8px;color:var(--blue);text-transform:uppercase}.panel h2{margin:7px 0 3px;font-family:\"Sora\",sans-serif;font-size:24px;letter-spacing:-.9px;line-height:1.15}.panel-desc{font-size:12px;color:#7d8ba0;line-height:1.45}.export{height:40px;display:flex;align-items:center;gap:8px;padding:0 14px;border:1px solid #dce5ef;border-radius:11px;background:#fff;color:#2b3d59;font-family:\"Space Grotesk\",sans-serif;font-size:11px;font-weight:700}.export svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}\n.filters{display:grid;grid-template-columns:minmax(0,1fr) 210px 120px;gap:12px;padding:12px 27px 18px}.search{height:46px;border:1px solid #dfe7f1;border-radius:11px;background:#fff;display:flex;align-items:center;gap:10px;padding:0 14px}.search svg{width:19px;height:19px;stroke:#60728e;fill:none;stroke-width:1.8}.search input{border:0;outline:0;min-width:0;width:100%;color:#263751;background:transparent;font-size:11px}.search input::placeholder{color:#8d99ab}.filters select{height:46px;border:1px solid #dfe7f1;border-radius:11px;background:#fff;padding:0 13px;color:#243652;font-size:11px;font-weight:650;outline:none}.count{height:46px;border:1px solid #c9dcf8;border-radius:11px;background:#f4f8ff;color:#0966ec;display:grid;place-items:center;font-size:11px;font-weight:700}\n.queue-list{padding:0 27px 26px;display:grid;gap:12px}.booking-row{width:100%;min-height:101px;border:1px solid #dfe6ef;border-radius:13px;background:#fff;display:grid;grid-template-columns:1.02fr 1.55fr auto 24px;align-items:center;gap:16px;padding:15px 18px;text-align:left;color:inherit}.booking-row.active{border-color:#77afff;background:linear-gradient(90deg,#f2f7ff,#fbfdff);box-shadow:inset 0 0 0 1px rgba(11,108,242,.04)}.booking-ref{font-size:10px;color:#7787a0;font-weight:700}.booking-name{font-family:\"Space Grotesk\",sans-serif;font-size:15px;font-weight:700;color:#14213c;margin-top:4px}.booking-phone{font-size:11px;color:#72829c;margin-top:4px}.vehicle-title{font-family:\"Space Grotesk\",sans-serif;font-size:13px;font-weight:700;color:#16243f}.vehicle-sub{font-size:10.5px;color:#75839b;margin-top:5px;line-height:1.35}.pill{display:inline-flex;align-items:center;justify-content:center;padding:7px 12px;border-radius:999px;background:#e8f4ff;color:#0a67dc;font-size:10px;font-weight:700}.row-chevron{font-size:28px;color:#203e68;line-height:1}\n.detail-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:21px 27px;border-bottom:1px solid #e3e9f1}.detail-title small{font-family:\"Space Grotesk\",sans-serif;font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#7887a0;font-weight:700}.detail-title h2{margin:6px 0 0;font-size:32px}.detail-actions{display:flex;align-items:center;gap:10px}.progress{height:42px;display:flex;align-items:center;gap:9px;padding:0 15px;border:1px solid #acd0ff;border-radius:11px;background:#f5f9ff;color:#0a62d4;font-family:\"Space Grotesk\",sans-serif;font-size:11px;font-weight:700}.progress svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.9}.more{width:42px;height:42px;border:1px solid #dce5ef;border-radius:11px;background:#fff;color:#233b60;font-size:22px;line-height:1}\n.appointment{margin:18px 27px 14px;min-height:88px;border:1px solid #bad5fb;border-radius:14px;background:linear-gradient(90deg,#eff6ff,#f7fbff);display:grid;grid-template-columns:56px 1.3fr 1px 1fr;align-items:center;gap:16px;padding:12px 14px}.appointment-icon{width:56px;height:56px;border-radius:14px;background:linear-gradient(145deg,#1478fa,#075adc);color:#fff;display:grid;place-items:center}.appointment-icon svg{width:27px;height:27px;fill:none;stroke:currentColor;stroke-width:1.9}.appt-label{font-family:\"Space Grotesk\",sans-serif;font-size:9px;letter-spacing:1.1px;text-transform:uppercase;color:#617492;font-weight:700}.appt-value{margin-top:5px;font-family:\"Sora\",sans-serif;font-size:17px;font-weight:700;color:#0b1834}.appt-sub{margin-top:4px;font-size:10px;color:#7b8aa2}.divider{height:46px;background:#cadaee}.service{display:flex;align-items:center;gap:12px}.service .mini-icon{width:42px;height:42px;border-radius:11px;background:#e9f4ff;color:#0968ed;display:grid;place-items:center}.service .mini-icon svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8}.service .appt-value{font-size:13px}\n.details{padding:0 27px 24px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.field{min-height:62px;border:1px solid #dfe6ef;border-radius:11px;background:#fff;display:grid;grid-template-columns:34px 1fr;align-items:center;gap:8px;padding:9px 12px}.field-icon{color:#0968ed;display:grid;place-items:center}.field-icon svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.field-label{font-size:9px;color:#7b8aa1}.field-value{font-family:\"Space Grotesk\",sans-serif;font-size:11px;font-weight:700;color:#16243f;margin-top:3px;line-height:1.25}\n@media(max-width:1200px){.workspace{grid-template-columns:1fr}.hero h1{font-size:48px}.hero{grid-template-columns:1fr}.hero-aside{justify-self:start}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}\n@media(max-width:760px){.wrap{width:calc(100% - 28px)}.brand-copy span,.date{display:none}.hero h1{font-size:38px}.hero-aside{flex-wrap:wrap}.tagline{display:none}.create{height:50px}.stats{grid-template-columns:1fr}.filters{grid-template-columns:1fr}.count{display:none}.booking-row{grid-template-columns:1fr auto}.booking-row>div:nth-child(2){grid-column:1}.booking-row>.pill{grid-column:2;grid-row:1}.row-chevron{grid-column:2;grid-row:2}.appointment{grid-template-columns:52px 1fr}.appointment .divider{display:none}.service{grid-column:1/-1}.details{grid-template-columns:1fr}}\n";
const BOOKINGS_PREVIEW_BODY_EXACT = "<div class=\"page\">\n  <div class=\"wrap\">\n    <header class=\"brandbar\">\n      <div class=\"brand\"><img src=\"/studio/studio-assets/windscreen-logo-clean.png\" alt=\"Windscreen Fitment Centre\" onerror=\"this.src='/files/branding/windscreen-fitment-centre-logo.png'\"><div class=\"brand-copy\"><strong>Windscreen Fitment Centre</strong><span>Clearer Views. Safer Journeys.</span></div></div>\n      <div class=\"brand-right\"><div class=\"online\"><span class=\"dot\"></span>Automation online</div><div class=\"date\"><strong>Thu, 5 Sep 2026</strong><span>Workshop Operations</span></div></div>\n    </header>\n\n    <section class=\"hero\">\n      <div><div class=\"eyebrow\">Appointment Desk</div><h1>Bookings</h1><p>Customer appointments captured from WhatsApp and the workshop team.</p></div>\n      <div class=\"hero-aside\"><div class=\"tagline\">More than glass.<br>A clearer tomorrow.</div><button class=\"create\" type=\"button\"><span style=\"font-size:26px;font-weight:400;line-height:1\">+</span>Create Booking</button></div>\n    </section>\n\n    <section class=\"stats\">\n      <article class=\"stat\"><div class=\"stat-icon sblue\"><svg viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M8 3v4M16 3v4M3 10h18\"/><path d=\"m9 15 2 2 4-4\"/></svg></div><div><label>Today</label><strong>0</strong><small>2026-09-05</small></div></article>\n      <article class=\"stat\"><div class=\"stat-icon sviolet\"><svg viewBox=\"0 0 24 24\"><path d=\"M5 12h14M14 7l5 5-5 5\"/></svg></div><div><label>Upcoming</label><strong>0</strong><small>future appointments</small></div></article>\n      <article class=\"stat\"><div class=\"stat-icon samber\"><svg viewBox=\"0 0 24 24\"><path d=\"M3 12h4l2-7 4 14 2-7h6\"/></svg></div><div><label>In Progress</label><strong>0</strong><small>already started</small></div></article>\n      <article class=\"stat\"><div class=\"stat-icon sgreen\"><svg viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"8\"/><path d=\"m8.5 12 2.2 2.2 4.8-5\"/></svg></div><div><label>Completed</label><strong>0</strong><small>finished bookings</small></div></article>\n    </section>\n\n    <section class=\"workspace\">\n      <article class=\"panel queue\">\n        <div class=\"panel-head\"><div><div class=\"panel-kicker\">Live Queue</div><h2>Booking Queue</h2><div class=\"panel-desc\">Select an appointment to view the full customer record.</div></div><button class=\"export\"><svg viewBox=\"0 0 24 24\"><path d=\"M12 3v12M8 11l4 4 4-4M5 18v2h14v-2\"/></svg>Export CSV</button></div>\n        <div class=\"filters\"><label class=\"search\"><svg viewBox=\"0 0 24 24\"><circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m20 20-4-4\"/></svg><input id=\"search\" placeholder=\"Search customer, phone, vehicle...\" /></label><select id=\"status\"><option>All Status</option><option>New</option></select><div class=\"count\">2 bookings</div></div>\n        <div class=\"queue-list\" id=\"queue\">\n          <button class=\"booking-row active\" data-name=\"edwell chidovi subaru forester jc-0007 +263778888567\" type=\"button\">\n            <div><div class=\"booking-ref\">JC-0007</div><div class=\"booking-name\">Edwell Chidovi</div><div class=\"booking-phone\">+263778888567</div></div>\n            <div><div class=\"vehicle-title\">Subaru forester</div><div class=\"vehicle-sub\">Adr 5677 \u00b7 \ud83e\ude9f Windscreen Replacement</div></div><span class=\"pill\">New</span><span class=\"row-chevron\">\u203a</span>\n          </button>\n          <button class=\"booking-row\" data-name=\"visionco test mercedes-benz c-class 1998 jc-0004 +263785805775\" type=\"button\">\n            <div><div class=\"booking-ref\">JC-0004</div><div class=\"booking-name\">VisionCo Test</div><div class=\"booking-phone\">+263785805775</div></div>\n            <div><div class=\"vehicle-title\">Mercedes-Benz C-Class 1998</div><div class=\"vehicle-sub\">To confirm \u00b7 \ud83e\ude9f Windscreen Repair</div></div><span class=\"pill\">New</span><span class=\"row-chevron\">\u203a</span>\n          </button>\n        </div>\n      </article>\n\n      <article class=\"panel detail\">\n        <div class=\"detail-head\"><div class=\"detail-title\"><small>Booking</small><h2>JC-0007</h2></div><div class=\"detail-actions\"><span class=\"pill\">New</span><button class=\"progress\"><svg viewBox=\"0 0 24 24\"><path d=\"m8 5 11 7-11 7Z\"/></svg>Mark as In Progress</button><button class=\"more\">\u2022\u2022\u2022</button></div></div>\n        <div class=\"appointment\"><div class=\"appointment-icon\"><svg viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M8 3v4M16 3v4M3 10h18\"/><path d=\"m9 15 2 2 4-4\"/></svg></div><div><div class=\"appt-label\">Scheduled Appointment</div><div class=\"appt-value\">- - -</div><div class=\"appt-sub\">235 Sandton Westgate</div></div><div class=\"divider\"></div><div class=\"service\"><div class=\"mini-icon\"><svg viewBox=\"0 0 24 24\"><path d=\"M6 3h8l4 4v14H6z\"/><path d=\"M14 3v5h5M9 12h6M9 16h6\"/></svg></div><div><div class=\"appt-label\">Service</div><div class=\"appt-value\">\ud83e\ude9f Windscreen Replacement</div></div></div></div>\n        <div class=\"details\">\n          <div class=\"field\"><div class=\"field-icon\"><svg viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M5 21v-2a7 7 0 0 1 14 0v2\"/></svg></div><div><div class=\"field-label\">Customer & Contact</div><div class=\"field-value\">Edwell Chidovi<br>\u260e +263778888567</div></div></div>\n          <div class=\"field\"><div class=\"field-icon\"><svg viewBox=\"0 0 24 24\"><path d=\"M5 16h14l-1.4-5H7z\"/><path d=\"M3 16v3h2M21 16v3h-2M7 19h10\"/></svg></div><div><div class=\"field-label\">Vehicle</div><div class=\"field-value\">Subaru forester<br>\u25a3 Adr 5677</div></div></div>\n          <div class=\"field\"><div class=\"field-icon\"><svg viewBox=\"0 0 24 24\"><path d=\"M12 3 19 6v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z\"/><path d=\"m9.5 12 1.7 1.7 3.6-3.6\"/></svg></div><div><div class=\"field-label\">Service Details</div><div class=\"field-value\">Windscreen Replacement</div></div></div>\n          <div class=\"field\"><div class=\"field-icon\"><svg viewBox=\"0 0 24 24\"><path d=\"M12 21s7-5.2 7-12a7 7 0 0 0-14 0c0 6.8 7 12 7 12Z\"/><circle cx=\"12\" cy=\"9\" r=\"2\"/></svg></div><div><div class=\"field-label\">Location</div><div class=\"field-value\">235 Sandton Westgate</div></div></div>\n          <div class=\"field\"><div class=\"field-icon\"><svg viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M8 3v4M16 3v4M3 10h18\"/></svg></div><div><div class=\"field-label\">Booking Date</div><div class=\"field-value\">-</div></div></div>\n          <div class=\"field\"><div class=\"field-icon\"><svg viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/></svg></div><div><div class=\"field-label\">Booking Time</div><div class=\"field-value\">-</div></div></div>\n          <div class=\"field\"><div class=\"field-icon\"><svg viewBox=\"0 0 24 24\"><path d=\"M5 21V4h11l-2 4 2 4H5\"/></svg></div><div><div class=\"field-label\">Priority</div><div class=\"field-value\">-</div></div></div>\n          <div class=\"field\"><div class=\"field-icon\"><svg viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 6v12M15 8.5A3 3 0 0 0 12 7c-1.7 0-3 .9-3 2s1.3 2 3 2 3 .9 3 2-1.3 2-3 2a3 3 0 0 1-3-1.5\"/></svg></div><div><div class=\"field-label\">Quote Amount</div><div class=\"field-value\">-</div></div></div>\n        </div>\n      </article>\n    </section>\n  </div>\n</div>";
const BOOKINGS_PREVIEW_SHADOW_ADAPTER = ":host{display:block;width:100%;--bg:#f5f8fc;--surface:#fff;--ink:#08142f;--text:#243652;--muted:#7888a2;--line:#dfe7f1;\n  --blue:#0b6cf2;--blue2:#0758da;--blue-soft:#edf5ff;--violet:#7650df;--violet-soft:#f3edff;\n  --amber:#d88405;--amber-soft:#fff4df;--green:#0da86f;--green-soft:#e8f8f0;--shadow:0 18px 46px rgba(31,59,96,.07);font-family:\"Manrope\",sans-serif !important;-webkit-font-smoothing:antialiased;color:var(--ink);background:var(--bg)}\n.queue-list{max-height:340px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable;padding-right:18px}.queue-list::-webkit-scrollbar{width:8px}.queue-list::-webkit-scrollbar-thumb{background:#c4d2e4;border-radius:999px}.queue-list::-webkit-scrollbar-track{background:transparent}";

function ExactBookingsPage({ data = {}, api, reload, refreshTick = 0 }) {
  const bookings = data.bookings || [];

  useEffect(() => {
    document.body.classList.add('vp-exact-bookings-native');
    document.body.classList.remove('vp-bookings-polish-active');
    return () => document.body.classList.remove('vp-exact-bookings-native');
  }, []);


  useEffect(() => {
    let alive = true;
    async function checkBookingsHealth() {
      try {
        const res = await fetch('/health', { cache: 'no-store' });
        const json = await res.json();
        if (alive) setBookingsAutomationOnline(Boolean(json?.ok && json?.ycloudConfigured));
      } catch {
        if (alive) setBookingsAutomationOnline(false);
      }
    }
    checkBookingsHealth();
    const timer = setInterval(checkBookingsHealth, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const [selectedRef, setSelectedRef] = useState(bookings[0]?.jobNo || bookings[0]?.ref || '');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [media, setMedia] = useState([]);
  const [busy, setBusy] = useState(false);
  const [localStatus, setLocalStatus] = useState({});
  const [bookingsAutomationOnline, setBookingsAutomationOnline] = useState(null);
  const previewHostRef = useRef(null);
  const [previewShadow, setPreviewShadow] = useState(null);

  useEffect(() => {
    if (!selectedRef && bookings[0]) {
      setSelectedRef(bookings[0].jobNo || bookings[0].ref || '');
    }
  }, [bookings, selectedRef]);

  const normalise = (item) => {
    const rawStatus = localStatus[item.jobNo || item.ref] || item.status || item.publicStatus || 'new';

    return {
      ref: item.jobNo || item.ref || item.job_no || 'JC-0000',
      customer: item.customerName || item.name || item.customer_name || 'Customer',
      phone: item.customerPhone || item.phone || item.customer_phone || '-',
      vehicle: item.vehicle || 'Vehicle to confirm',
      registration: item.registration || item.regNo || item.reg || item.reg_no || 'To confirm',
      service: item.service || item.jobType || 'Service to confirm',
      location: item.location || 'To confirm',
      bookingDate: item.bookingDate || item.booking_date || item.data?.bookingDate || item.data?.preferredDate || '-',
      bookingTime: item.bookingTime || item.booking_time || item.data?.bookingTime || item.data?.preferredTime || 'Not provided',
      bookingPdfUrl: item.bookingPdfUrl || item.data?.bookingPdfUrl || '',
      bookingPdfPath: item.bookingPdfPath || item.data?.bookingPdfPath || '',
      priority: item.priority || item.data?.priority || '-',
      quoteAmount: item.quoteAmount || item.quote_amount || '-',
      fitter: item.fitter || item.assignedTo || item.assigned_to || '-',
      invoice: item.invoiceStatus || item.invoice_status || '-',
      status: rawStatus
    };
  };

  const rows = bookings.map(normalise);

  const filtered = rows.filter(row => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || `${row.ref} ${row.customer} ${row.phone} ${row.vehicle} ${row.registration} ${row.service}`.toLowerCase().includes(q);
    const matchesStatus = status === 'all' || String(row.status || '').toLowerCase().includes(status);
    return matchesSearch && matchesStatus;
  });

  const selected = rows.find(row => row.ref === selectedRef) || filtered[0] || rows[0] || null;

  useEffect(() => {
    let alive = true;

    async function loadMedia() {
      if (!selected) return setMedia([]);

      const pin = localStorage.getItem('adminPin') || localStorage.getItem('pin') || localStorage.getItem('studioPin') || '';

      try {
        const qs = new URLSearchParams({
          jobNo: selected.ref,
          phone: selected.phone || ''
        });

        const res = await fetch(`/api/studio/v3/booking-media?${qs.toString()}`, {
          headers: { 'x-admin-pin': pin },
          cache: 'no-store'
        });

        const json = await res.json();
        if (alive) setMedia(json.media || []);
      } catch {
        if (alive) setMedia([]);
      }
    }

    loadMedia();
    return () => { alive = false; };
  }, [selected?.ref, selected?.phone, refreshTick]);

  const photos = media.filter(doc => {
    const u = String(doc.url || doc.filename || '').toLowerCase();
    const m = String(doc.mimeType || doc.mime_type || '').toLowerCase();
    return m.includes('image') || /\.(jpg|jpeg|png|webp|heic)$/i.test(u);
  });

  const files = media.filter(doc => !photos.includes(doc));

  async function proceed() {
    if (!selected) return;

    setBusy(true);

    try {
      await api(
        `/jobs/${encodeURIComponent(selected.ref)}/status`,
        'POST',
        {
          status: 'in_progress',
          note: 'Booking started from the dashboard.',
          notify: true
        }
      );

      setLocalStatus(prev => ({
        ...prev,
        [selected.ref]: 'in_progress'
      }));

      if (typeof reload === 'function') {
        await reload();
      }

      window.alert(
        'Booking moved to In Progress. The customer update was processed through WhatsApp.'
      );
    } catch (error) {
      window.alert(
        error.message ||
        'The booking could not be started.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function createBooking() {
    const customerPhone = window.prompt(
      'Customer WhatsApp number, for example +263772123456:'
    );

    if (!customerPhone) return;

    const customerName =
      window.prompt('Customer name:') || '';

    const vehicle =
      window.prompt('Vehicle make and model:') || '';

    const registration =
      window.prompt('Vehicle registration number:') || '';

    const service =
      window.prompt('Required service:') || '';

    const location =
      window.prompt('Customer or workshop location:') || '';

    const bookingDate =
      window.prompt('Booking date in YYYY-MM-DD format:') || '';

    const bookingTime =
      window.prompt('Booking time in HH:MM format:') || '';

    const notes =
      window.prompt('Optional booking notes:') || '';

    if (!service.trim()) {
      window.alert(
        'The required service must be entered.'
      );
      return;
    }

    try {
      await api(
        '/bookings',
        'POST',
        {
          customerPhone,
          customerName,
          vehicle,
          registration,
          service,
          location,
          bookingDate,
          bookingTime,
          priority: 'Normal',
          notes
        }
      );

      window.alert(
        'Booking saved successfully.'
      );

      if (typeof reload === 'function') {
        await reload();
      }
    } catch (error) {
      window.alert(
        error.message ||
        'The booking could not be saved.'
      );
    }
  }

  const statusLabel = (value) => {
    const t = String(value || '').toLowerCase();
    if (t.includes('progress')) return 'In Progress';
    if (t.includes('complete')) return 'Completed';
    if (t.includes('closed')) return 'Closed';
    if (t.includes('quote')) return 'Quote Stage';
    return 'New';
  };

  // APPROVED_BOOKINGS_V1_LITERAL — approved preview HTML/CSS is injected unchanged; only data/actions are wired live.
  const todayKeyValue = todayKey();
  const todayDisplay = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const todayCount = rows.filter(row => String(row.bookingDate || '') === todayKeyValue).length;
  const upcomingCount = rows.filter(row => String(row.bookingDate || '') > todayKeyValue && !String(row.status || '').toLowerCase().includes('complete')).length;
  const inProgressCount = rows.filter(row => String(row.status || '').toLowerCase().includes('progress')).length;
  const completedCount = rows.filter(row => String(row.status || '').toLowerCase().includes('complete')).length;

  useEffect(() => {
    if (!previewHostRef.current || previewShadow) return;
    const shadow = previewHostRef.current.shadowRoot || previewHostRef.current.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Sora:wght@500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap');${BOOKINGS_PREVIEW_SHADOW_ADAPTER}\n${BOOKINGS_PREVIEW_CSS_EXACT}</style>${BOOKINGS_PREVIEW_BODY_EXACT}`;
    setPreviewShadow(shadow);
  }, [previewShadow]);

  useEffect(() => {
    if (!previewShadow) return;
    const d = previewShadow;
    const esc = value => String(value ?? '').replace(/[&<>\"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#39;' }[ch]));
    const clean = value => (!value || value === '-' ? '-' : String(value));

    const online = d.querySelector('.online');
    if (online) {
      const dot = online.querySelector('.dot');
      const text = bookingsAutomationOnline === null ? 'Checking automation' : bookingsAutomationOnline ? 'Automation online' : 'Automation offline';
      online.childNodes.forEach(node => { if (node.nodeType === 3) node.remove(); });
      online.append(document.createTextNode(text));
      if (dot) dot.style.background = bookingsAutomationOnline === false ? '#d15c67' : '#14b877';
    }
    const dateStrong = d.querySelector('.date strong');
    if (dateStrong) dateStrong.textContent = todayDisplay;

    const statValues = d.querySelectorAll('.stat strong');
    [todayCount, upcomingCount, inProgressCount, completedCount].forEach((value, i) => { if (statValues[i]) statValues[i].textContent = String(value); });
    const statSmall = d.querySelectorAll('.stat small');
    if (statSmall[0]) statSmall[0].textContent = todayKeyValue;

    const searchInput = d.querySelector('.search input');
    if (searchInput) {
      searchInput.value = search;
      searchInput.oninput = e => setSearch(e.target.value);
    }
    const statusSelect = d.querySelector('.filters select');
    if (statusSelect) {
      statusSelect.innerHTML = '<option value="all">All Status</option><option value="new">New</option><option value="progress">In Progress</option><option value="completed">Completed</option>';
      statusSelect.value = status;
      statusSelect.onchange = e => setStatus(e.target.value);
    }
    const count = d.querySelector('.count');
    if (count) count.textContent = `${filtered.length} bookings`;

    const exportBtn = d.querySelector('.export');
    if (exportBtn) exportBtn.onclick = () => downloadCSV('bookings-export.csv', filtered);
    const createBtn = d.querySelector('.create');
    if (createBtn) createBtn.onclick = createBooking;

    const list = d.querySelector('.queue-list');
    if (list) {
      if (filtered.length) {
        list.innerHTML = filtered.map(row => `
          <button class="booking-row ${selected?.ref === row.ref ? 'active' : ''}" data-ref="${esc(row.ref)}" type="button">
            <div><div class="booking-ref">${esc(row.ref)}</div><div class="booking-name">${esc(row.customer)}</div><div class="booking-phone">${esc(row.phone)}</div></div>
            <div><div class="vehicle-title">${esc(row.vehicle)}</div><div class="vehicle-sub">${esc(row.registration)} · 🪟 ${esc(row.service)}</div></div>
            <span class="pill">${esc(statusLabel(row.status))}</span><span class="row-chevron">›</span>
          </button>`).join('');
        list.querySelectorAll('.booking-row').forEach(btn => { btn.onclick = () => setSelectedRef(btn.dataset.ref || ''); });
      } else {
        list.innerHTML = '<div style="min-height:170px;display:grid;place-items:center;text-align:center;color:#8190a8;font-size:12px">No bookings match your filters.</div>';
      }
    }

    if (selected) {
      const title = d.querySelector('.detail-title h2');
      if (title) title.textContent = selected.ref;
      const detailPill = d.querySelector('.detail-actions .pill');
      if (detailPill) detailPill.textContent = statusLabel(selected.status);
      const apptValue = d.querySelector('.appointment > div:nth-child(2) .appt-value');
      const apptSub = d.querySelector('.appointment > div:nth-child(2) .appt-sub');
      if (apptValue) apptValue.textContent = selected.bookingDate !== '-' ? `${selected.bookingDate}${selected.bookingTime !== '-' ? ` · ${selected.bookingTime}` : ''}` : '- - -';
      if (apptSub) apptSub.textContent = clean(selected.location);
      const serviceValue = d.querySelector('.service .appt-value');
      if (serviceValue) serviceValue.textContent = `🪟 ${clean(selected.service)}`;

      const vals = d.querySelectorAll('.details .field .field-value');
      const setLines = (el, lines) => {
        if (!el) return;
        el.replaceChildren();
        lines.forEach((line, i) => {
          if (i) el.append(document.createElement('br'));
          el.append(document.createTextNode(line));
        });
      };
      setLines(vals[0], [clean(selected.customer), `☎ ${clean(selected.phone)}`]);
      setLines(vals[1], [clean(selected.vehicle), `▣ ${clean(selected.registration)}`]);
      setLines(vals[2], [clean(selected.service)]);
      setLines(vals[3], [clean(selected.location)]);
      setLines(vals[4], [clean(selected.bookingDate)]);
      setLines(vals[5], [clean(selected.bookingTime)]);
      setLines(vals[6], [clean(selected.priority)]);
      setLines(vals[7], [clean(selected.quoteAmount)]);

      const detailsGrid = d.querySelector('.details');
      let bookingDocs = d.querySelector('.booking-documents-live');
      if (!bookingDocs && detailsGrid) {
        bookingDocs = document.createElement('section');
        bookingDocs.className = 'booking-documents-live';
        detailsGrid.insertAdjacentElement('afterend', bookingDocs);
      }

      if (bookingDocs) {
        const documentRows = [];
        const seenUrls = new Set();

        if (selected.bookingPdfUrl) {
          const url = String(selected.bookingPdfUrl);
          seenUrls.add(url);
          documentRows.push({
            filename: `${selected.ref}-booking-confirmation.pdf`,
            url,
            mimeType: 'application/pdf',
            source: 'booking_confirmation'
          });
        }

        files.forEach(file => {
          const url = String(file?.url || '');
          if (!url || seenUrls.has(url)) return;
          seenUrls.add(url);
          documentRows.push(file);
        });

        const cards = documentRows.length
          ? documentRows.slice(0, 6).map(file => {
              const rawName = String(file?.filename || 'Booking document');
              const rawUrl = vpSafeDashboardMediaUrl(file?.url || '');
              const mime = String(file?.mimeType || file?.mime_type || '').toLowerCase();
              const isPdf = mime.includes('pdf') || /\.pdf(?:$|\?)/i.test(rawName) || /\.pdf(?:$|\?)/i.test(rawUrl);
              const label = String(file?.source || '') === 'booking_confirmation' ? 'Booking Confirmation PDF' : rawName;
              return `
                <a href="${esc(rawUrl)}" target="_blank" rel="noreferrer" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid #dbe6f4;border-radius:12px;background:#fff;text-decoration:none;color:#10213f">
                  <span style="display:grid;place-items:center;width:42px;height:42px;border-radius:10px;background:${isPdf ? '#fff1f2' : '#eef5ff'};color:${isPdf ? '#d12f43' : '#0b6cf2'};font-size:11px;font-weight:800">${isPdf ? 'PDF' : 'FILE'}</span>
                  <span style="min-width:0;flex:1"><strong style="display:block;font-size:12px;line-height:1.25">${esc(label)}</strong><small style="display:block;margin-top:4px;color:#7b8ca6;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(rawName)}</small></span>
                  <span style="font-size:11px;font-weight:800;color:#0b6cf2">Open</span>
                </a>`;
            }).join('')
          : '<div style="padding:14px;border:1px dashed #cbd8e8;border-radius:12px;color:#7d8ca2;font-size:11px">No booking documents available.</div>';

        bookingDocs.innerHTML = `
          <div style="margin:18px 0 0;padding:16px;border:1px solid #dfe7f1;border-radius:16px;background:#f8fbff">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <div><div style="font-size:9px;font-weight:800;letter-spacing:.08em;color:#7385a0;text-transform:uppercase">Booking Documents</div><div style="margin-top:3px;font-size:12px;font-weight:800;color:#13233f">Confirmation & uploaded files</div></div>
              <span style="font-size:10px;font-weight:800;color:#0b6cf2">${documentRows.length} file${documentRows.length === 1 ? '' : 's'}</span>
            </div>
            <div style="display:grid;gap:9px">${cards}</div>
          </div>`;
      }

      const progressBtn = d.querySelector('.progress');
      if (progressBtn) {
        const inProgress = statusLabel(selected.status) === 'In Progress';
        progressBtn.disabled = busy || inProgress;
        const textNode = [...progressBtn.childNodes].find(node => node.nodeType === 3);
        if (textNode) textNode.textContent = busy ? 'Processing...' : inProgress ? 'In Progress' : 'Mark as In Progress';
        progressBtn.onclick = proceed;
      }
    }
  }, [previewShadow, bookings, localStatus, selectedRef, search, status, bookingsAutomationOnline, busy, media]);

  return <div ref={previewHostRef} className="bookings-preview-live-host" style={{ display: 'block', width: '100%', minWidth: 0 }} />;
}


function ExactIcon({ name }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true"
  };

  const icons = {
    user: (
      <svg {...common}>
        <path d="M20 21a8 8 0 0 0-16 0" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
    phone: (
      <svg {...common}>
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.8 19.8 0 0 1 3.08 5.18 2 2 0 0 1 5.06 3h3a2 2 0 0 1 2 1.72c.12.9.33 1.77.63 2.6a2 2 0 0 1-.45 2.11L9 10.67a16 16 0 0 0 4.33 4.33l1.24-1.24a2 2 0 0 1 2.11-.45c.83.3 1.7.51 2.6.63A2 2 0 0 1 22 16.92Z" />
      </svg>
    ),
    car: (
      <svg {...common}>
        <path d="M19 17h2l-2-6-2-3H7l-2 3-2 6h2" />
        <path d="M7 17h10" />
        <circle cx="7" cy="17" r="2" />
        <circle cx="17" cy="17" r="2" />
        <path d="M6 11h12" />
      </svg>
    ),
    file: (
      <svg {...common}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8" />
        <path d="M8 17h6" />
      </svg>
    ),
    shield: (
      <svg {...common}>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-5" />
      </svg>
    ),
    map: (
      <svg {...common}>
        <path d="M12 21s7-4.35 7-11a7 7 0 1 0-14 0c0 6.65 7 11 7 11Z" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
    ),
    calendar: (
      <svg {...common}>
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18" />
      </svg>
    ),
    clock: (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
    flag: (
      <svg {...common}>
        <path d="M5 22V4" />
        <path d="M5 4h12l-1.5 4L17 12H5" />
      </svg>
    ),
    dollar: (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6v12" />
        <path d="M15 9.5A3 3 0 0 0 12 8c-1.7 0-3 .9-3 2s1.3 2 3 2 3 .9 3 2-1.3 2-3 2a3 3 0 0 1-3-1.5" />
      </svg>
    ),
    userCheck: (
      <svg {...common}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="m16 11 2 2 4-4" />
      </svg>
    ),
    invoice: (
      <svg {...common}>
        <path d="M6 2h12v20l-3-2-3 2-3-2-3 2Z" />
        <path d="M9 7h6" />
        <path d="M9 11h6" />
        <path d="M9 15h4" />
      </svg>
    ),
    image: (
      <svg {...common}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.5-3.5a2 2 0 0 0-3 0L7 19" />
      </svg>
    )
  };

  return <i className="exact-real-icon">{icons[name] || icons.file}</i>;
}

function InfoTile({ icon, label, value }) {
  return (
    <div className="exact-info-tile">
      <ExactIcon name={icon} />
      <div>
        <span>{label}</span>
        <strong>{value || '-'}</strong>
      </div>
    </div>
  );
}


function WorkshopMetricCard({ icon: Icon, label, value, note, tone = 'blue' }) {
  return (
    <article className={`vp-metric-card ${tone}`}>
      <span className="vp-metric-icon"><Icon size={27} strokeWidth={1.8} /></span>
      <div className="vp-metric-copy">
        <p>{label}</p>
        <strong>{Number(value || 0).toLocaleString()}</strong>
        <small>{note}</small>
      </div>
      <span className="vp-metric-arrow" aria-hidden="true">›</span>
    </article>
  );
}

function WorkshopStatus({ children }) {
  const value = String(children || 'Pending');
  return <span className={`vp-work-status ${statusClass(value)}`}><i />{value.replaceAll('_', ' ')}</span>;
}

function DashboardWifiOverview({ onOpen }) {
  const WIFI_BASE = 'http://127.0.0.1:18764';
  const TOKEN_KEY = 'windscreen.wifi.receptionDesktopToken.live.v1';
  const [summary, setSummary] = useState({ status: 'checking', ready: 0, active: 0, history: 0, updated: '' });

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const parseTime = value => {
      if (!value) return NaN;
      return Date.parse(String(value).replace(' ', 'T'));
    };

    const refresh = async () => {
      const token = localStorage.getItem(TOKEN_KEY) || '';
      if (!token) {
        if (!cancelled) setSummary({ status: 'not-paired', ready: 0, active: 0, history: 0, updated: '' });
        return;
      }

      try {
        const headers = { Authorization: `Bearer ${token}` };
        const statusResponse = await fetch(`${WIFI_BASE}/wifi/status`, { headers, cache: 'no-store' });
        if (!statusResponse.ok) throw new Error('offline');
        const status = await statusResponse.json();
        if (!status?.online) {
          if (!cancelled) setSummary(current => ({ ...current, status: 'wifi-off', updated: new Date().toLocaleTimeString() }));
          return;
        }

        const voucherResponse = await fetch(`${WIFI_BASE}/vouchers`, { headers, cache: 'no-store' });
        if (!voucherResponse.ok) throw new Error('offline');
        const data = await voucherResponse.json();
        const vouchers = Array.isArray(data?.vouchers) ? data.vouchers : [];
        const now = Date.now();
        let ready = 0;
        let active = 0;
        let history = 0;

        for (const voucher of vouchers) {
          const firstUse = Boolean(voucher?.firstUse || voucher?.firstLogin || voucher?.sessionStart);
          const state = String(voucher?.lifecycleState || voucher?.state || '').toLowerCase();
          const issuedMs = parseTime(voucher?.issued || voucher?.createdAt || voucher?.createdDate);
          const redeemMs = parseTime(voucher?.redeemBy);
          const deadlineMs = Number.isFinite(redeemMs) ? redeemMs : (Number.isFinite(issuedMs) ? issuedMs + 5 * 60 * 1000 : NaN);
          const dataLeft = Number(voucher?.remainingBytes);
          const timeLeft = Number(voucher?.remainingSeconds);
          const blocked = /blocked|cancel|expired|deadline|late login|finished|ended/.test(state);

          if (!firstUse) {
            if (!blocked && (!Number.isFinite(deadlineMs) || deadlineMs > now)) ready += 1;
            else history += 1;
            continue;
          }

          const hasData = !Number.isFinite(dataLeft) || dataLeft > 0;
          const hasTime = !Number.isFinite(timeLeft) || timeLeft > 0;
          if (!blocked && hasData && hasTime && /usage started|active|connected/.test(state)) active += 1;
          else history += 1;
        }

        if (!cancelled) setSummary({ status: 'online', ready, active, history, updated: new Date().toLocaleTimeString() });
      } catch {
        if (!cancelled) setSummary(current => ({ ...current, status: 'connector-offline' }));
      }
    };

    refresh();
    timer = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  const online = summary.status === 'online';
  const statusText = online ? 'Reception WiFi online' : summary.status === 'wifi-off' ? 'Reception WiFi off' : summary.status === 'not-paired' ? 'Reception desktop not paired' : summary.status === 'checking' ? 'Checking Reception WiFi…' : 'Reception connector unavailable';

  return (
    <section className="vp-wifi-overview-card" aria-label="WiFi voucher overview">
      <div className="vp-wifi-overview-head">
        <div className="vp-wifi-overview-title"><span><Wifi size={18}/></span><div><b>WiFi Vouchers</b><small>{statusText}</small></div></div>
        <button type="button" onClick={onOpen}>Open WiFi Vouchers <ChevronRight size={16}/></button>
      </div>
      <div className="vp-wifi-overview-metrics">
        <div><span>READY</span><strong>{summary.ready}</strong><small>waiting for customer</small></div>
        <div><span>ACTIVE</span><strong>{summary.active}</strong><small>customers online</small></div>
        <div><span>HISTORY</span><strong>{summary.history}</strong><small>used or expired</small></div>
        <div><span>LIVE REFRESH</span><strong>5 sec</strong><small>{summary.updated ? `Last ${summary.updated}` : 'local Reception data'}</small></div>
      </div>
    </section>
  );
}

function PremiumDashboardPage({ data = {}, setActive }) {
  const bookings = data.bookings || [];
  const claims = data.claims || data.insuranceClaims || [];
  const jobs = data.jobs || [];

  const isDone = value => /completed|closed|cancelled|declined/i.test(String(value || ''));
  const awaitingQuote = [...bookings, ...jobs].filter(item => /quote_pending|quote stage|awaiting quote|quote requested/i.test(String(item.status || item.publicStatus || ''))).length;
  const newEnquiries = bookings.filter(item => !isDone(item.status) && /(^|\b)new(\b|$)|booking_pending|pending booking|awaiting details/i.test(String(item.status || 'new'))).length;
  const activeJobs = jobs.filter(item => /approved|booked|scheduled|in[_ ]?progress|fitment|fitting/i.test(String(item.status || item.publicStatus || '')) && !isDone(item.status || item.publicStatus)).length;
  const openClaims = claims.filter(item => !isDone(item.status || item.publicStatus)).length;
  const recentOperations = (jobs.length ? jobs : bookings).slice(0, 6);

  const itemRef = (item, index) => item.jobNo || item.job_no || item.bookingNo || item.ref || `REC-${String(index + 1).padStart(3, '0')}`;
  const customerName = item => item.customerName || item.customer_name || item.name || 'WhatsApp Customer';
  const itemVehicle = item => item.vehicle || item.vehicleDetails || item.vehicle_description || 'Vehicle to confirm';
  const itemStatus = item => item.status || item.publicStatus || 'Pending';
  const itemUpdated = item => {
    const raw = item.updatedAt || item.updated_at || item.createdAt || item.created_at || item.date || item.timestamp;
    if (!raw) return 'Recently';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return 'Recently';
    const diff = Math.max(0, Date.now() - date.getTime());
    const mins = Math.floor(diff / 60000);
    if (mins < 2) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  };

  return (
    <div className="vp-dashboard vp-dashboard-v2 view-enter">
      <section className="vp-dashboard-hero-v2">
        <div className="vp-dashboard-hero-copy-v2">
          <h1>Windscreen <span>Fitment Centre</span></h1>
          <p>Track customer enquiries, quotations, workshop jobs, claims and stock from one clear workspace.</p>
        </div>
        <div className="vp-dashboard-hero-actions-v2">
          <button type="button" className="vp-hero-btn-v2 secondary" onClick={() => setActive('parts')}><ClipboardList size={19} strokeWidth={1.8} /> Stock Catalogue</button>
          <button type="button" className="vp-hero-btn-v2 primary" onClick={() => setActive('bookings')}><CalendarCheck size={19} strokeWidth={1.8} /> Open Bookings <span>›</span></button>
        </div>
      </section>

      <section className="vp-metric-grid vp-metric-grid-v2">
        <WorkshopMetricCard icon={MessageCircle} label="New Enquiries" value={newEnquiries} note="Waiting in customer flow" tone="blue" />
        <WorkshopMetricCard icon={FileText} label="Awaiting Quote" value={awaitingQuote} note="Ready for quotation review" tone="amber" />
        <WorkshopMetricCard icon={BriefcaseBusiness} label="Active Jobs" value={activeJobs} note="Workshop work in progress" tone="green" />
        <WorkshopMetricCard icon={ShieldCheck} label="Open Claims" value={openClaims} note="Insurance cases requiring action" tone="violet" />
      </section>

      <DashboardWifiOverview onOpen={() => setActive('wifi')} />

      <section className="vp-dashboard-grid vp-dashboard-grid-v2">
        <article className="vp-panel vp-operations-panel vp-operations-panel-v2">
          <div className="vp-panel-heading vp-panel-heading-v2">
            <div>
              <span className="vp-page-eyebrow vp-page-eyebrow-v2"><Activity size={16} strokeWidth={1.9} /> Recent Activity</span>
              <h2>Recent Workshop Activity</h2>
              <p>The latest customer and workshop records requiring attention.</p>
            </div>
            <button type="button" className="vp-view-all-v2" onClick={() => setActive('jobs')}>View all jobs <span>›</span></button>
          </div>

          <div className="vp-operation-list vp-operation-list-v2">
            <div className="vp-operation-head-v2"><span>Customer / Vehicle</span><span>Job No.</span><span>Status</span><span>Updated</span><span /></div>
            {recentOperations.length ? recentOperations.map((item, index) => (
              <button type="button" className="vp-operation-row vp-operation-row-v2" key={item.id || itemRef(item, index)} onClick={() => setActive(jobs.length ? 'jobs' : 'bookings')}>
                <div className="vp-operation-main-v2">
                  <span className="vp-operation-icon"><Car size={18} strokeWidth={1.8} /></span>
                  <div className="vp-operation-main"><strong>{customerName(item)}</strong><span>{itemVehicle(item)}</span></div>
                </div>
                <span className="vp-operation-ref-v2">{itemRef(item, index)}</span>
                <WorkshopStatus>{itemStatus(item)}</WorkshopStatus>
                <span className="vp-operation-updated-v2">{itemUpdated(item)}</span>
                <span className="vp-operation-view-v2">View ›</span>
              </button>
            )) : (
              <div className="vp-empty-panel">
                <span><Activity size={22} /></span>
                <h3>No workshop activity yet</h3>
                <p>New WhatsApp enquiries and workshop jobs will appear here automatically.</p>
              </div>
            )}
          </div>
        </article>

        <article className="vp-panel vp-quick-panel vp-quick-panel-v2">
          <div className="vp-panel-heading vp-panel-heading-v2 compact">
            <div>
              <span className="vp-page-eyebrow vp-page-eyebrow-v2"><ArrowRight size={16} strokeWidth={1.9} /> Quick Actions</span>
              <h2>Get things done</h2>
              <p>Access key workshop operations quickly.</p>
            </div>
          </div>
          <div className="vp-quick-actions vp-quick-actions-v2">
            <button type="button" onClick={() => setActive('bookings')}><span><CalendarCheck size={21} /></span><div><strong>Bookings</strong><small>Review new customer bookings</small></div><ChevronRight size={17} /></button>
            <button type="button" onClick={() => setActive('jobs')}><span><BriefcaseBusiness size={21} /></span><div><strong>Workshop Jobs</strong><small>Track active fitment work</small></div><ChevronRight size={17} /></button>
            <button type="button" onClick={() => setActive('parts')}><span><ClipboardList size={21} /></span><div><strong>Stock Catalogue</strong><small>Prices, fitment and quantities</small></div><ChevronRight size={17} /></button>
            <button type="button" onClick={() => setActive('claims')}><span><ShieldCheck size={21} /></span><div><strong>Insurance Claims</strong><small>Documents and signatures</small></div><ChevronRight size={17} /></button>
          </div>
          <div className="vp-quick-foot vp-quick-foot-v2">
            <Wifi size={20} strokeWidth={1.8} />
            <span>{data.config?.whatsappConfigured ? 'WhatsApp messaging is configured for workshop operations.' : 'WhatsApp messaging configuration needs attention.'}</span>
            <b>{data.config?.whatsappConfigured ? 'Configured' : 'Needs Setup'}</b>
          </div>
        </article>
      </section>
    </div>
  );
}

function PremiumMetricCard({ icon: Icon, title, value, subtitle, footer, accent }) {
  return (
    <article className={`premium-metric-card ${accent}`}>
      <div className="premium-metric-icon">
        <Icon size={30} />
      </div>

      <div>
        <span>{title}</span>
        <strong>{value}</strong>
        <p>{subtitle}</p>
      </div>

      <footer>
        <CheckCircle2 size={16} />
        <span>{footer}</span>
      </footer>
    </article>
  );
}


// VP_EXTERNAL_JOB_CARDS_DASHBOARD_V1
function vpExternalRecordDraft(record) {
  if (!record) return null;

  return {
    externalRef: record.externalRef || '',
    parsed: {
      ...(record.parsed || {}),
      interior: {
        ...(record.parsed?.interior || {})
      }
    },
    reviewStatus:
      record.reviewStatus || 'needs_review',
    paymentType:
      record.paymentType || 'Review Required',
    paymentReference:
      record.paymentReference || '',
    amount: Number(record.amount || 0),
    currency: record.currency || 'USD',

    // VP_EXTERNAL_VERIFIED_PRODUCT_FRONTEND_V1
    glassCode:
      record.glassCode || '',
    productQuantity:
      Number(record.productQuantity || 1),
    productCode:
      record.productCode || '',
    productName:
      record.productName || '',
    productMatchStatus:
      record.productMatchStatus ||
      'unmatched',
    matchedProductId:
      record.matchedProductId || '',
    matchedProductCode:
      record.matchedProductCode || '',
    matchedProductName:
      record.matchedProductName || '',
    matchedProductCost:
      Number(
        record.matchedProductCost || 0
      ),
    matchedProductPrice:
      Number(
        record.matchedProductPrice || 0
      ),
    matchedProductStock:
      record.matchedProductStock === null ||
      record.matchedProductStock ===
        undefined
        ? null
        : Number(
            record.matchedProductStock
          ),
    productMatchSource:
      record.productMatchSource || '',
    productMatchCheckedAt:
      record.productMatchCheckedAt || '',
    posStatus:
      record.posStatus || 'not_submitted',
    posReference:
      record.posReference || '',
    posError:
      record.posError || ''
  };
}

function ExternalJobCardsPage({ api, refreshTick = 0 }) {
  const [records, setRecords] = useState([]);
  const [month, setMonth] = useState(currentJobMonth);
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    document.body.classList.add('vp-external-job-cards-native');
    return () => document.body.classList.remove('vp-external-job-cards-native');
  }, []);
  const [counts, setCounts] = useState({
    total: 0,
    needsReview: 0,
    ready: 0,
    submitted: 0,
    failed: 0
  });

  // VP_EXTERNAL_JOB_CARDS_POS_BUTTON_V1
  const [submissionEnabled, setSubmissionEnabled] = useState(false);

  const [selectedRef, setSelectedRef] =
    useState('');

  const [draft, setDraft] =
    useState(null);
  const draftServerSnapshotRef = useRef({
    externalRef: '',
    json: ''
  });

  const [filter, setFilter] =
    useState('all');

  const [search, setSearch] =
    useState('');

  const [rawText, setRawText] =
    useState('');

  const [preview, setPreview] =
    useState(null);

  const [busy, setBusy] =
    useState('');

  const [notice, setNotice] =
    useState('');


  // VP_EXTERNAL_FULL_CATALOGUE_FRONTEND_V1
  const [catalogueResults, setCatalogueResults] =
    useState([]);
  const [catalogueStats, setCatalogueStats] =
    useState(null);
  const [catalogueOpen, setCatalogueOpen] =
    useState(false);
  const [catalogueSearch, setCatalogueSearch] =
    useState('');
  const [catalogueBusy, setCatalogueBusy] =
    useState('');

  async function loadRecords(preferredRef = '', requestedMonth = month) {
    const json = await api(
      `/external-job-cards?month=${encodeURIComponent(requestedMonth)}`
    );

    const nextRecords =
      Array.isArray(json.records)
        ? json.records
        : [];

    setRecords(nextRecords);

    setCounts({
      total:
        Number(json.counts?.total || 0),
      needsReview:
        Number(json.counts?.needsReview || 0),
      ready:
        Number(json.counts?.ready || 0),
      submitted:
        Number(json.counts?.submitted || 0),
      failed:
        Number(json.counts?.failed || 0)
    });

    setSubmissionEnabled(Boolean(json.submissionEnabled));

    setSelectedRef(current => {
      const requested =
        preferredRef || current;

      if (
        requested &&
        nextRecords.some(
          row =>
            row.externalRef === requested
        )
      ) {
        return requested;
      }

      return (
        nextRecords[0]?.externalRef || ''
      );
    });
  }

  useEffect(() => {
    loadRecords('', month).catch(error => {
      setNotice(
        error.message ||
        'Could not load external job cards.'
      );
    });
  }, [month]);
  useStudioRefreshPulse(refreshTick, () => {
    loadRecords('', month).catch(() => {});
  });

  useEffect(() => {
    const selected = records.find(
      row =>
        row.externalRef === selectedRef
    );

    const freshDraft =
      vpExternalRecordDraft(selected);

    setDraft(current => {
      if (!freshDraft) {
        draftServerSnapshotRef.current = {
          externalRef: '',
          json: ''
        };
        return null;
      }

      const freshJson =
        JSON.stringify(freshDraft);
      const previousServer =
        draftServerSnapshotRef.current;

      const sameRecord =
        current?.externalRef ===
        freshDraft.externalRef;

      const hasUnsavedEdits =
        sameRecord &&
        previousServer.externalRef ===
          freshDraft.externalRef &&
        JSON.stringify(current) !==
          previousServer.json;

      draftServerSnapshotRef.current = {
        externalRef:
          freshDraft.externalRef,
        json: freshJson
      };

      return hasUnsavedEdits
        ? current
        : freshDraft;
    });
  }, [selectedRef, records]);


  useEffect(() => {
    const code = String(
      draft?.glassCode || ''
    ).trim();

    if (
      !draft ||
      draft.reviewStatus === 'submitted' ||
      !code
    ) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      searchCatalogue(code, {
        silent: true,
        limit: 12
      });
    }, 280);

    return () => window.clearTimeout(timer);
  }, [draft?.glassCode]);

  useEffect(() => {
    if (!catalogueOpen) return undefined;

    const timer = window.setTimeout(() => {
      searchCatalogue(catalogueSearch, {
        silent: true,
        limit: 50
      });
    }, 260);

    return () => window.clearTimeout(timer);
  }, [catalogueSearch, catalogueOpen]);

  const filteredRecords = records.filter(
    record => {
      const statusMatch =
        filter === 'all' ||
        record.reviewStatus === filter;

      const needle =
        search.trim().toLowerCase();

      const text = [
        record.externalRef,
        record.parsed?.customerName,
        record.parsed?.customerPhone,
        record.parsed?.vehicleDescription,
        record.parsed?.vehicle,
        record.parsed?.registration,
        record.paymentType,
        record.reviewStatus
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return (
        statusMatch &&
        (!needle || text.includes(needle))
      );
    }
  );

  function clearVerifiedProduct(current, glassCode) {
    return {
      ...current,
      glassCode,
      productCode: '',
      productName: '',
      productMatchStatus: 'unmatched',
      matchedProductId: '',
      matchedProductCode: '',
      matchedProductName: '',
      matchedProductCost: 0,
      matchedProductPrice: 0,
      matchedProductStock: null,
      productMatchSource: '',
      productMatchCheckedAt: ''
    };
  }

  async function searchCatalogue(
    value = '',
    { silent = false, limit = 50 } = {}
  ) {
    if (!silent) setCatalogueBusy('search');

    try {
      const query = String(value || '').trim();
      const json = await api(
        `/keith-products?query=${encodeURIComponent(
          query
        )}&limit=${limit}&includeIncomplete=true`
      );

      setCatalogueResults(
        Array.isArray(json.products)
          ? json.products
          : []
      );
      setCatalogueStats(json.stats || null);
    } catch (error) {
      if (!silent) setNotice(error.message);
    } finally {
      if (!silent) setCatalogueBusy('');
    }
  }

  function openCatalogue() {
    const query = String(
      draft?.glassCode || ''
    ).trim();

    setCatalogueSearch(query);
    setCatalogueOpen(true);
    searchCatalogue(query, { limit: 50 });
  }

  function chooseCatalogueProduct(product) {
    if (!product?.metadataComplete) {
      setNotice(
        `${product?.productCode || 'This code'} requires product creation or restoration in Keith Tech.`
      );
      return;
    }

    setDraft(current =>
      clearVerifiedProduct(
        current,
        product.productCode
      )
    );
    setCatalogueSearch(product.productCode);
    setCatalogueOpen(false);
    setNotice(
      `${product.productCode} — ${product.productName} selected. Click Verify Glass Code to confirm it on this job card.`
    );
  }

  async function refreshCatalogue() {
    setCatalogueBusy('refresh');
    setNotice('');

    try {
      const json = await api(
        '/keith-products/refresh',
        'POST',
        { includeHistory: false }
      );

      setCatalogueStats(json.stats || null);
      await searchCatalogue(
        catalogueOpen
          ? catalogueSearch
          : draft?.glassCode || '',
        { silent: true, limit: catalogueOpen ? 50 : 12 }
      );
      setNotice(
        `Keith Tech catalogue refreshed: ${Number(json.stats?.complete || 0)} active products and ${Number(json.stats?.stockKnown || 0)} stock records.`
      );
    } catch (error) {
      setNotice(error.message);
    } finally {
      setCatalogueBusy('');
    }
  }

  async function requestProductCreation() {
    if (!draft?.externalRef) return;

    const requestedCode = String(
      draft.glassCode || ''
    ).trim();

    if (!requestedCode) {
      setNotice(
        'Enter the required Glass Code before creating a product request.'
      );
      return;
    }

    const suggestedName = [
      draft.parsed?.vehicleDescription ||
        draft.parsed?.vehicle || '',
      draft.parsed?.glassType || 'Glass'
    ].filter(Boolean).join(' ');

    const reason = window.prompt(
      'Why must this product be created or restored in Keith Tech?',
      'No complete active Keith Tech product matched this Glass Code.'
    );

    if (reason === null) return;

    setCatalogueBusy('request');
    setNotice('');

    try {
      const json = await api(
        `/external-job-cards/${encodeURIComponent(
          draft.externalRef
        )}/product-request`,
        'POST',
        {
          requestedCode,
          requestedName: suggestedName,
          reason
        }
      );

      const updated = json.record;
      setRecords(current =>
        current.map(record =>
          record.externalRef === updated.externalRef
            ? updated
            : record
        )
      );
      setDraft(vpExternalRecordDraft(updated));
      await loadRecords(updated.externalRef);
      setNotice(
        json.duplicate
          ? `A pending product request already exists for ${requestedCode}.`
          : `Product creation request #${json.request.id} was created for ${requestedCode}.`
      );
    } catch (error) {
      setNotice(error.message);
    } finally {
      setCatalogueBusy('');
    }
  }

  function updateParsed(key, value) {
    setDraft(current => ({
      ...current,
      parsed: {
        ...(current?.parsed || {}),
        [key]: value
      }
    }));
  }

  function updateInterior(key, value) {
    setDraft(current => ({
      ...current,
      parsed: {
        ...(current?.parsed || {}),
        interior: {
          ...(current?.parsed?.interior || {}),
          [key]: value
        }
      }
    }));
  }

  async function previewJobCard() {
    if (!rawText.trim()) {
      setNotice(
        'Paste the complete job card first.'
      );
      return;
    }

    setBusy('preview');
    setNotice('');

    try {
      const json = await api(
        '/external-job-cards/preview',
        'POST',
        { rawText }
      );

      setPreview(json);
      setNotice(
        `Preview complete: ${Number(
          json.extractionScore || 0
        )}% extracted.`
      );
    } catch (error) {
      setPreview(null);
      setNotice(error.message);
    } finally {
      setBusy('');
    }
  }

  async function captureJobCard() {
    if (!rawText.trim()) {
      setNotice(
        'Paste the complete job card first.'
      );
      return;
    }

    setBusy('capture');
    setNotice('');

    try {
      const sendCapture = () =>
        api(
          '/external-job-cards',
          'POST',
          { rawText }
        );

      let json;

      try {
        json = await sendCapture();
      } catch (error) {
        const status = Number(error?.status || 0);
        const transient =
          status >= 500 ||
          (
            status === 0 &&
            /fetch|network|connection|load failed/i.test(
              String(error?.message || '')
            )
          );

        if (!transient) {
          throw error;
        }

        setNotice(
          'Connection interrupted. Retrying job-card upload...'
        );

        await new Promise(resolve =>
          window.setTimeout(resolve, 700)
        );

        json = await sendCapture();
      }

      const ref =
        json.record?.externalRef || '';
      const targetMonth = json.record?.createdAt
        ? currentJobMonth(new Date(json.record.createdAt))
        : currentJobMonth();

      setMonth(targetMonth);
      await loadRecords(ref, targetMonth);

      setRawText('');
      setPreview(null);

      setNotice(
        json.duplicate
          ? `Job card ${ref} already existed. No duplicate was created.`
          : `Job card ${ref} added to the review inbox.`
      );
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy('');
    }
  }

  // VP_EXTERNAL_PRODUCT_VERIFY_ACTION_V1
  async function verifyProduct() {
    if (!draft?.externalRef) {
      return;
    }

    const glassCode =
      String(
        draft.glassCode || ''
      ).trim();

    const productQuantity =
      Number(
        draft.productQuantity || 0
      );

    if (!glassCode) {
      setNotice(
        'Enter the exact Keith Tech Glass Code.'
      );

      return;
    }

    if (
      !Number.isFinite(
        productQuantity
      ) ||
      productQuantity <= 0
    ) {
      setNotice(
        'Enter a valid product quantity.'
      );

      return;
    }

    if (
      selectedRecord?.reviewStatus ===
      'submitted'
    ) {
      setNotice(
        'Submitted job cards cannot be remapped.'
      );

      return;
    }

    setBusy('verify');
    setNotice('');

    try {
      const json = await api(
        `/external-job-cards/${encodeURIComponent(
          draft.externalRef
        )}/verify-product`,
        'POST',
        {
          glassCode,
          productQuantity
        }
      );

      const updated =
        json.record;

      setRecords(current =>
        current.map(record =>
          record.externalRef ===
          updated.externalRef
            ? updated
            : record
        )
      );

      setDraft(
        vpExternalRecordDraft(
          updated
        )
      );

      await loadRecords(
        updated.externalRef
      );

      setNotice(
        `${updated.externalRef}: ${json.match.productCode} — ${json.match.productName} verified successfully.`
      );
    } catch (error) {
      await loadRecords(
        draft.externalRef
      ).catch(() => {});

      setNotice(
        error.message
      );
    } finally {
      setBusy('');
    }
  }

  async function saveReview() {
    if (!draft?.externalRef) return;

    setBusy('save');
    setNotice('');

    try {
      const json = await api(
        `/external-job-cards/${encodeURIComponent(
          draft.externalRef
        )}`,
        'PATCH',
        {
          parsed: draft.parsed,
          reviewStatus:
            draft.reviewStatus,
          paymentType:
            draft.paymentType,
          paymentReference:
            draft.paymentReference,
          amount:
            Number(draft.amount || 0),
          currency:
            draft.currency,
          productCode:
            draft.productCode,
          productName:
            draft.productName
        }
      );

      const updated = json.record;

      setRecords(current =>
        current.map(record =>
          record.externalRef ===
          updated.externalRef
            ? updated
            : record
        )
      );

      setDraft(
        vpExternalRecordDraft(updated)
      );

      await loadRecords(
        updated.externalRef
      );

      setNotice(
        `${updated.externalRef} review saved successfully.`
      );
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy('');
    }
  }

  async function submitToKeithTech() {
    if (!draft?.externalRef || !selectedRecord) {
      return;
    }

    if (!submissionEnabled) {
      setNotice(
        'Keith Tech submission is still locked.'
      );

      return;
    }

    if (
      !selectedRecord.readyForSubmission ||
      selectedRecord.reviewStatus !==
        'ready'
    ) {
      setNotice(
        'Save the review and mark the job card Ready before submitting.'
      );

      return;
    }

    const verifiedProductReady =
      draft.productMatchStatus ===
        'verified' &&
      selectedRecord
        .productMatchStatus ===
        'verified' &&
      String(
        draft.glassCode || ''
      ).trim() !== '' &&
      draft.glassCode ===
        draft.productCode &&
      draft.productCode ===
        draft.matchedProductCode &&
      draft.productName ===
        draft.matchedProductName &&
      draft.glassCode ===
        selectedRecord.glassCode &&
      Number(
        draft.productQuantity || 0
      ) ===
        Number(
          selectedRecord
            .productQuantity || 0
        );

    if (!verifiedProductReady) {
      setNotice(
        'Verify the Glass Code and quantity before submitting.'
      );

      return;
    }

    if (
      !window.confirm(
        `Send ${draft.externalRef} to Keith Tech POS?`
      )
    ) {
      return;
    }

    setBusy('submit');
    setNotice('');

    try {
      const json = await api(
        `/external-job-cards/${encodeURIComponent(
          draft.externalRef
        )}/submit`,
        'POST'
      );

      const updated =
        json.record;

      await loadRecords(
        updated?.externalRef ||
        draft.externalRef
      );

      setNotice(
        json.duplicatePrevented
          ? `${draft.externalRef} already existed in Keith Tech. No duplicate was created.`
          : `${draft.externalRef} was submitted to Keith Tech successfully.`
      );
    } catch (error) {
      await loadRecords(
        draft.externalRef
      ).catch(() => {});

      setNotice(error.message);
    } finally {
      setBusy('');
    }
  }

  function statusLabel(status) {
    return {
      needs_review: 'Needs Review',
      ready: 'Ready',
      held: 'On Hold',
      submitted: 'Submitted',
      failed: 'Needs Attention'
    }[status] || status || 'Needs Review';
  }

  function fieldValue(value) {
    return value === undefined ||
      value === null
        ? ''
        : value;
  }

  async function exportMonthlyPdf() {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      await vpDownloadStudioPdf(
        `/external-job-cards-month-report.pdf?month=${encodeURIComponent(month)}`,
        `Windscreen-External-Job-Cards-${month}-Report.pdf`
      );
    } catch (error) {
      setNotice(error.message || 'Unable to export PDF report.');
    } finally {
      setExportBusy(false);
    }
  }

  const selectedRecord = records.find(
    record =>
      record.externalRef === selectedRef
  );

  return (
    <Page
      title="External Job Cards"
      sub="Job cards received from staff WhatsApp messages or entered manually."
    >
      <section className="job-month-control ejc-month-control" aria-label="External job cards by month">
        <div className="job-month-navigation">
          <button type="button" aria-label="Previous month" onClick={() => setMonth(value => shiftJobMonth(value, -1))}>‹</button>
          <strong>{jobMonthLabel(month)}</strong>
          <button type="button" aria-label="Next month" disabled={month >= currentJobMonth()} onClick={() => setMonth(value => shiftJobMonth(value, 1))}>›</button>
        </div>
        <div className="job-month-report-actions">
          <div className="job-month-total" aria-live="polite">
            <span>Job Card Count</span>
            <strong>{counts.total}</strong>
            <small>Created in selected month · CAT</small>
          </div>
          <button type="button" className="job-month-export" title="Export PDF statistics" onClick={exportMonthlyPdf} disabled={exportBusy}>
            <Download size={14} /> {exportBusy ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </section>

      <section className="ejc-summary-grid ejc-command-metrics">
        <article className="ejc-metric total">
          <div className="ejc-metric-icon"><ClipboardList size={18} /></div>
          <div><span>Total Job Cards</span><strong>{counts.total}</strong><small>received from staff</small></div>
        </article>

        <article className="ejc-metric review">
          <div className="ejc-metric-icon"><AlertTriangle size={18} /></div>
          <div><span>Needs Review</span><strong>{counts.needsReview}</strong><small>waiting for staff</small></div>
        </article>

        <article className="ejc-metric ready">
          <div className="ejc-metric-icon"><CheckCircle2 size={18} /></div>
          <div><span>Ready</span><strong>{counts.ready}</strong><small>complete and approved</small></div>
        </article>

        <article className="ejc-metric submitted">
          <div className="ejc-metric-icon"><ExternalLink size={18} /></div>
          <div><span>Submitted</span><strong>{counts.submitted}</strong><small>sent to Keith Tech</small></div>
        </article>
      </section>

      {notice && (
        <div className="ejc-notice">
          {notice}
        </div>
      )}

      <section className="ejc-operations-head">
        <div>
          <span className="ejc-kicker">STAFF JOB CARD OPERATIONS</span>
          <h2>Individual Job Cards</h2>
          <p>Select any job card to review the customer, vehicle, product and submission details.</p>
        </div>
        <div className="ejc-operations-actions">
          <span className="ejc-live-count"><i /> {filteredRecords.length} visible</span>
        </div>
      </section>

      <section className="ejc-capture-card ejc-manual-drawer ejc-manual-always-visible">
        <div className="ejc-section-head">
          <div>
            <span>Manual Intake</span>
            <h2>Paste an external job card</h2>
            <p>
              WhatsApp job cards from authorised staff arrive automatically. Use this for manual entry when needed.
            </p>
          </div>
        </div>

        <textarea
          value={rawText}
          onChange={event => setRawText(event.target.value)}
          placeholder="Paste the complete WINDSCREEN JOB CARD text here."
          rows={6}
        />

        <div className="ejc-capture-actions">
          <button type="button" onClick={previewJobCard} disabled={busy === 'preview' || !rawText.trim()}>
            {busy === 'preview' ? 'Checking...' : 'Preview Extraction'}
          </button>
          <button type="button" className="primary" onClick={captureJobCard} disabled={busy === 'capture' || !rawText.trim()}>
            {busy === 'capture' ? 'Adding...' : 'Add to Review Inbox'}
          </button>
        </div>

        {preview?.parsed && (
          <div className="ejc-preview">
            <div><span>Extraction</span><strong>{Number(preview.extractionScore || 0)}%</strong></div>
            <div><span>Customer</span><strong>{preview.parsed.customerName || 'Review required'}</strong></div>
            <div><span>Vehicle</span><strong>{preview.parsed.vehicleDescription || preview.parsed.vehicle || 'Review required'}</strong></div>
            <div><span>Payment</span><strong>{preview.paymentType || 'Review Required'}</strong></div>
          </div>
        )}
      </section>

      <section className="ejc-workspace">
        <aside className="ejc-inbox">
          <div className="ejc-inbox-tools">
            <div>
              <h2>Job Card Inbox</h2>
              <span>
                {filteredRecords.length} records
              </span>
            </div>

            <button
              type="button"
              onClick={() =>
                loadRecords().catch(error =>
                  setNotice(error.message)
                )
              }
            >
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>

          <div className="ejc-search-row">
            <Search size={17} />

            <input
              value={search}
              onChange={event =>
                setSearch(event.target.value)
              }
              placeholder="Search customer, vehicle or reference"
            />
          </div>

          <div className="ejc-filter-row">
            {[
              ['all', 'All'],
              ['needs_review', 'Needs Review'],
              ['ready', 'Ready'],
              ['submitted', 'Submitted'],
              ['failed', 'Attention']
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={
                  filter === value
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  setFilter(value)
                }
              >
                {label}
              </button>
            ))}
          </div>

          <div className="ejc-record-list">
            {!filteredRecords.length && (
              <div className="ejc-empty">
                <ClipboardList size={32} />
                <strong>
                  No external job cards
                </strong>
                <span>
                  Authorised WhatsApp job cards will
                  appear here automatically.
                </span>
              </div>
            )}

            {filteredRecords.map(record => (
              <button
                key={record.externalRef}
                type="button"
                className={
                  selectedRef ===
                  record.externalRef
                    ? 'selected'
                    : ''
                }
                onClick={() =>
                  setSelectedRef(
                    record.externalRef
                  )
                }
              >
                <div>
                  <strong>
                    {record.externalRef}
                  </strong>

                  <span
                    className={`ejc-status ${record.reviewStatus}`}
                  >
                    {statusLabel(
                      record.reviewStatus
                    )}
                  </span>
                </div>

                <b className="ejc-record-customer">
                  {record.parsed?.customerName || 'Customer review required'}
                </b>

                <div className="ejc-record-meta">
                  <small>{String(record.createdAt || '').slice(0, 16)}</small>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="ejc-review-panel">
          {!draft || !selectedRecord ? (
            <div className="ejc-empty large">
              <ClipboardList size={38} />
              <strong>
                Select a job card
              </strong>
              <span>
                Choose a record from the review inbox
                to inspect and edit it.
              </span>
            </div>
          ) : (
            <>
              <header className="ejc-review-head">
                <div>
                  <span>External Job Card</span>
                  <h2>{draft.externalRef}</h2>
                  <p>
                    Captured{' '}
                    {selectedRecord.createdAt ||
                      'from WhatsApp'}
                  </p>
                </div>

                <div className="ejc-review-badges">
                  <span
                    className={`ejc-status ${selectedRecord.reviewStatus}`}
                  >
                    {statusLabel(
                      selectedRecord.reviewStatus
                    )}
                  </span>

                  <span
                    className={`ejc-pos-status ${selectedRecord.posStatus}`}
                  >
                    POS:{' '}
                    {String(selectedRecord.posStatus ||
                      'not_submitted').toUpperCase()}
                  </span>
                </div>
              </header>

              <section className="ejc-form-section">
                <div className="ejc-section-title">
                  <h3>Customer Information</h3>
                  <p>
                    Confirm the details extracted from
                    the job card.
                  </p>
                </div>

                <div className="ejc-form-grid">
                  <label>
                    <span>Customer Name</span>
                    <input
                      value={fieldValue(
                        draft.parsed.customerName
                      )}
                      onChange={event =>
                        updateParsed(
                          'customerName',
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>Phone</span>
                    <input
                      value={fieldValue(
                        draft.parsed.customerPhone
                      )}
                      onChange={event =>
                        updateParsed(
                          'customerPhone',
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>Cash / Insurance</span>
                    <input
                      value={fieldValue(
                        draft.parsed.cashInsurance
                      )}
                      onChange={event =>
                        updateParsed(
                          'cashInsurance',
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>Job Date</span>
                    <input
                      value={fieldValue(
                        draft.parsed.jobDate
                      )}
                      onChange={event =>
                        updateParsed(
                          'jobDate',
                          event.target.value
                        )
                      }
                    />
                  </label>
                </div>
              </section>

              <section className="ejc-form-section">
                <div className="ejc-section-title">
                  <h3>Vehicle and Glass</h3>
                  <p>
                    Vehicle, glass and fitting
                    information.
                  </p>
                </div>

                <div className="ejc-form-grid">
                  <label>
                    <span>Vehicle</span>
                    <input
                      value={fieldValue(
                        draft.parsed.vehicle
                      )}
                      onChange={event =>
                        updateParsed(
                          'vehicle',
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>Year</span>
                    <input
                      value={fieldValue(
                        draft.parsed.vehicleYear
                      )}
                      onChange={event =>
                        updateParsed(
                          'vehicleYear',
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>Registration</span>
                    <input
                      value={fieldValue(
                        draft.parsed.registration
                      )}
                      onChange={event =>
                        updateParsed(
                          'registration',
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>Mileage</span>
                    <input
                      value={fieldValue(
                        draft.parsed.mileage
                      )}
                      onChange={event =>
                        updateParsed(
                          'mileage',
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>Which Glass</span>
                    <input
                      value={fieldValue(
                        draft.parsed.glassType
                      )}
                      onChange={event =>
                        updateParsed(
                          'glassType',
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>Sensor / Camera</span>
                    <input
                      value={fieldValue(
                        draft.parsed.sensorCamera
                      )}
                      onChange={event =>
                        updateParsed(
                          'sensorCamera',
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>Sealant Type</span>
                    <input
                      value={fieldValue(
                        draft.parsed.sealantType
                      )}
                      onChange={event =>
                        updateParsed(
                          'sealantType',
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>SABS Approved</span>
                    <select
                      value={fieldValue(
                        draft.parsed.sabsApproved
                      )}
                      onChange={event =>
                        updateParsed(
                          'sabsApproved',
                          event.target.value
                        )
                      }
                    >
                      <option value="">
                        Review Required
                      </option>
                      <option value="Yes">
                        Yes
                      </option>
                      <option value="No">
                        No
                      </option>
                    </select>
                  </label>

                  <label>
                    <span>Booked By</span>
                    <input
                      value={fieldValue(
                        draft.parsed.bookedBy
                      )}
                      onChange={event =>
                        updateParsed(
                          'bookedBy',
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>Fitter</span>
                    <input
                      value={fieldValue(
                        draft.parsed.fitterName
                      )}
                      onChange={event =>
                        updateParsed(
                          'fitterName',
                          event.target.value
                        )
                      }
                    />
                  </label>
                </div>
              </section>

              <section className="ejc-form-section">
                <div className="ejc-section-title">
                  <h3>Interior Checklist</h3>
                  <p>
                    Confirm the vehicle items and
                    condition.
                  </p>
                </div>

                <div className="ejc-check-grid">
                  {[
                    ['spareWheel', 'Spare Wheel'],
                    ['jack', 'Jack'],
                    ['wheelSpanner', 'Wheel Spanner'],
                    ['triangles', 'Triangles'],
                    ['fireExtinguisher', 'Fire Extinguisher'],
                    ['radio', 'Radio'],
                    ['mats', 'Mats'],
                    ['doorPanelsDamaged', 'Door Panels Damaged'],
                    ['windowWindersWork', 'Window Winders Work'],
                    ['valuablesRemoved', 'Valuables Removed']
                  ].map(([key, label]) => (
                    <label key={key}>
                      <span>{label}</span>

                      <select
                        value={fieldValue(
                          draft.parsed
                            ?.interior?.[key]
                        )}
                        onChange={event =>
                          updateInterior(
                            key,
                            event.target.value
                          )
                        }
                      >
                        <option value="">
                          Review
                        </option>
                        <option value="Yes">
                          Yes
                        </option>
                        <option value="No">
                          No
                        </option>
                      </select>
                    </label>
                  ))}
                </div>

                <label className="ejc-full-field">
                  <span>Items Left in Vehicle</span>
                  <textarea
                    rows={3}
                    value={fieldValue(
                      draft.parsed
                        ?.interior?.itemsLeft
                    )}
                    onChange={event =>
                      updateInterior(
                        'itemsLeft',
                        event.target.value
                      )
                    }
                  />
                </label>
              </section>

              <section className="ejc-form-section commercial">
                <div className="ejc-section-title">
                  <h3>Invoice and Payment</h3>
                  <p>
                    Required before the record can be
                    marked ready.
                  </p>
                </div>

                <div className="ejc-form-grid">
                  <label>
                    <span>Payment Type</span>
                    <select
                      value={draft.paymentType}
                      onChange={event =>
                        setDraft(current => ({
                          ...current,
                          paymentType:
                            event.target.value
                        }))
                      }
                    >
                      <option value="Review Required">
                        Review Required
                      </option>
                      <option value="Cash">
                        Cash
                      </option>
                      <option value="NMB USD">
                        NMB USD
                      </option>
                      <option value="NMB ZWG">
                        NMB ZWG
                      </option>
                      <option value="Credit">
                        Credit
                      </option>
                    </select>
                  </label>

                  <label>
                    <span>Payment Reference</span>
                    <input
                      value={
                        draft.paymentReference
                      }
                      onChange={event =>
                        setDraft(current => ({
                          ...current,
                          paymentReference:
                            event.target.value
                        }))
                      }
                      placeholder="Optional bank or credit reference"
                    />
                  </label>

                  <label>
                    <span>Amount</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.amount}
                      onChange={event =>
                        setDraft(current => ({
                          ...current,
                          amount:
                            event.target.value
                        }))
                      }
                    />
                  </label>

                  <label>
                    <span>Currency</span>
                    <select
                      value={draft.currency}
                      onChange={event =>
                        setDraft(current => ({
                          ...current,
                          currency:
                            event.target.value
                        }))
                      }
                    >
                      <option value="USD">
                        USD
                      </option>
                      <option value="ZWG">
                        ZWG
                      </option>
                    </select>
                  </label>

                  <div className="ejc-catalogue-field">
                    <label>
                      <span>Glass Code</span>
                      <input
                        value={draft.glassCode}
                        placeholder="Search code, vehicle or glass name"
                        disabled={
                          selectedRecord
                            .reviewStatus ===
                          'submitted'
                        }
                        onFocus={() => {
                          if (
                            selectedRecord
                              .reviewStatus !==
                            'submitted'
                          ) {
                            setCatalogueOpen(true);
                          }
                        }}
                        onChange={event => {
                          const value =
                            event.target.value
                              .trimStart();
                          setDraft(current =>
                            clearVerifiedProduct(
                              current,
                              value
                            )
                          );
                          setCatalogueSearch(value);
                          setCatalogueOpen(true);
                        }}
                      />

                      <small>
                        Type a code or name, then select the exact
                        Keith Tech catalogue product.
                      </small>
                    </label>

                    <div className="ejc-catalogue-toolbar">
                      <button
                        type="button"
                        onClick={openCatalogue}
                        disabled={
                          selectedRecord.reviewStatus ===
                          'submitted'
                        }
                      >
                        Browse Full Catalogue
                      </button>

                      <button
                        type="button"
                        onClick={refreshCatalogue}
                        disabled={
                          catalogueBusy === 'refresh'
                        }
                      >
                        {catalogueBusy === 'refresh'
                          ? 'Refreshing...'
                          : 'Refresh Catalogue'}
                      </button>
                    </div>

                    {catalogueStats && (
                      <div className="ejc-catalogue-stats">
                        <strong>
                          {Number(catalogueStats.complete || 0)} active products
                        </strong>
                        <span>
                          {Number(catalogueStats.total || 0)} catalogue codes
                        </span>
                        <span>
                          {Number(catalogueStats.stockKnown || 0)} stock records
                        </span>
                      </div>
                    )}

                    {catalogueOpen &&
                      selectedRecord.reviewStatus !==
                        'submitted' && (
                      <div className="ejc-catalogue-panel">
                        <div className="ejc-catalogue-search">
                          <Search size={17} />
                          <input
                            value={catalogueSearch}
                            onChange={event =>
                              setCatalogueSearch(
                                event.target.value
                              )
                            }
                            placeholder="Search all Keith Tech codes and product names"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setCatalogueOpen(false)
                            }
                          >
                            Close
                          </button>
                        </div>

                        <div className="ejc-catalogue-results">
                          {catalogueBusy === 'search' ? (
                            <div className="ejc-catalogue-empty">
                              Loading catalogue...
                            </div>
                          ) : catalogueResults.length ? (
                            catalogueResults.map(product => (
                              <button
                                type="button"
                                key={
                                  product.productCode ||
                                  product.productId
                                }
                                className={`ejc-catalogue-product ${
                                  product.metadataComplete
                                    ? 'selectable'
                                    : 'creation-required'
                                }`}
                                onClick={() =>
                                  chooseCatalogueProduct(
                                    product
                                  )
                                }
                              >
                                <div>
                                  <strong>
                                    {product.productCode}
                                  </strong>
                                  <span>
                                    {product.productName ||
                                      'Product details missing'}
                                  </span>
                                  <small>
                                    {product.category ||
                                      'Uncategorised'}
                                  </small>
                                </div>

                                <div className="ejc-catalogue-values">
                                  <span>
                                    Stock: {product.inStock === null
                                      ? 'Unknown'
                                      : product.inStock}
                                  </span>
                                  <span>
                                    Cost: ${Number(
                                      product.cost || 0
                                    ).toFixed(2)}
                                  </span>
                                  <span>
                                    Price: {product.price === null
                                      ? 'Unknown'
                                      : `$${Number(
                                          product.price || 0
                                        ).toFixed(2)}`}
                                  </span>
                                  <b>
                                    {product.metadataComplete
                                      ? 'Select Product'
                                      : 'Creation Required'}
                                  </b>
                                </div>
                              </button>
                            ))
                          ) : (
                            <div className="ejc-catalogue-empty">
                              No catalogue products matched this search.
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {selectedRecord.reviewStatus !==
                      'submitted' &&
                      String(draft.glassCode || '').trim() &&
                      draft.productMatchStatus !==
                        'verified' && (
                      <button
                        type="button"
                        className="ejc-product-request-btn"
                        onClick={requestProductCreation}
                        disabled={
                          catalogueBusy === 'request'
                        }
                      >
                        {catalogueBusy === 'request'
                          ? 'Creating Request...'
                          : 'Request Product Creation'}
                      </button>
                    )}
                  </div>

                  <label>
                    <span>Quantity</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={
                        draft.productQuantity
                      }
                      disabled={
                        selectedRecord
                          .reviewStatus ===
                        'submitted'
                      }
                      onChange={event =>
                        setDraft(current => ({
                          ...current,
                          productQuantity:
                            event.target.value,
                          productMatchStatus:
                            'unmatched'
                        }))
                      }
                    />

                    <small>
                      Re-verify after changing the quantity.
                    </small>
                  </label>

                  <div
                    className={`ejc-product-match ${
                      draft.productMatchStatus ===
                        'verified' &&
                      draft.glassCode ===
                        draft.matchedProductCode
                        ? 'verified'
                        : 'unverified'
                    }`}
                  >
                    <div className="ejc-product-match-icon">
                      {draft.productMatchStatus ===
                        'verified' &&
                      draft.glassCode ===
                        draft.matchedProductCode ? (
                        <CheckCircle2 size={24} />
                      ) : (
                        <AlertTriangle size={24} />
                      )}
                    </div>

                    <div className="ejc-product-match-copy">
                      <span>
                        {selectedRecord
                          .reviewStatus ===
                        'submitted'
                          ? 'Historical product record'
                          : draft
                                .productMatchStatus ===
                              'verified' &&
                            draft.glassCode ===
                              draft
                                .matchedProductCode
                            ? 'Verified Keith Tech product'
                            : 'Product verification required'}
                      </span>

                      <strong>
                        {draft.matchedProductName ||
                          draft.productName ||
                          'No verified product selected'}
                      </strong>

                      <small>
                        {draft.productMatchStatus ===
                          'verified' &&
                        draft.glassCode ===
                          draft
                            .matchedProductCode
                          ? [
                              `Code: ${draft.matchedProductCode}`,
                              `Cost: $${Number(
                                draft.matchedProductCost ||
                                  0
                              ).toFixed(2)}`,
                              `Price: $${Number(
                                draft.matchedProductPrice ||
                                  0
                              ).toFixed(2)}`,
                              `Stock: ${
                                draft.matchedProductStock ===
                                  null
                                  ? 'Not returned'
                                  : draft.matchedProductStock
                              }`
                            ].join(' | ')
                          : selectedRecord
                                .reviewStatus ===
                              'submitted'
                            ? 'This card was submitted before verified product matching was introduced.'
                            : 'Verification links the code, product name, cost and stock to one Keith Tech record.'}
                      </small>
                    </div>

                    <button
                      type="button"
                      className="ejc-verify-product-btn"
                      onClick={verifyProduct}
                      disabled={
                        busy === 'verify' ||
                        selectedRecord
                          .reviewStatus ===
                          'submitted' ||
                        !String(
                          draft.glassCode || ''
                        ).trim()
                      }
                    >
                      {selectedRecord
                        .reviewStatus ===
                      'submitted'
                        ? 'Already Submitted'
                        : busy === 'verify'
                          ? 'Verifying...'
                          : draft
                                .productMatchStatus ===
                              'verified' &&
                            draft.glassCode ===
                              draft
                                .matchedProductCode
                            ? 'Re-verify Glass Code'
                            : 'Verify Glass Code'}
                    </button>
                  </div>

                  <label>
                    <span>Review Status</span>
                    <select
                      value={draft.reviewStatus}
                      onChange={event =>
                        setDraft(current => ({
                          ...current,
                          reviewStatus:
                            event.target.value
                        }))
                      }
                    >
                      <option value="needs_review">
                        Needs Review
                      </option>
                      <option value="ready">
                        Ready
                      </option>
                      <option value="held">
                        On Hold
                      </option>
                      <option value="failed">
                        Needs Attention
                      </option>
                    </select>
                  </label>
                </div>
              </section>

              <section className="ejc-readiness">
                <div>
                  {selectedRecord.readyForSubmission ? (
                    <CheckCircle2 size={25} />
                  ) : (
                    <AlertTriangle size={25} />
                  )}

                  <div>
                    <strong>
                      {selectedRecord.readyForSubmission
                        ? 'Ready for submission'
                        : 'More information required'}
                    </strong>

                    <span>
                      {selectedRecord
                        .readyForSubmission
                        ? 'All required commercial fields are complete.'
                        : (
                            selectedRecord
                              .missingForSubmission ||
                            []
                          ).join(', ') ||
                          'Save the review to refresh readiness.'}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  className="primary"
                  onClick={saveReview}
                  disabled={busy === 'save'}
                >
                  {busy === 'save'
                    ? 'Saving...'
                    : 'Save Review'}
                </button>
              </section>

              <section
                className={`ejc-pos-lock ${
                  submissionEnabled
                    ? 'enabled'
                    : ''
                }`}
              >
                {submissionEnabled ? (
                  <CheckCircle2 size={22} />
                ) : (
                  <Lock size={22} />
                )}

                <div>
                  <strong>
                    {submissionEnabled
                      ? 'Keith Tech submission is available'
                      : 'Keith Tech submission is locked'}
                  </strong>

                  <span>
                    {submissionEnabled
                      ? 'Only reviewed records marked Ready can be submitted.'
                      : 'The engine is installed and awaiting final activation.'}
                  </span>
                </div>

                <button
                  type="button"
                  className={
                    submissionEnabled
                      ? 'primary'
                      : ''
                  }
                  onClick={
                    submitToKeithTech
                  }
                  disabled={
                    !submissionEnabled ||
                    busy === 'submit' ||
                    busy === 'verify' ||
                    !selectedRecord
                      .readyForSubmission ||
                    selectedRecord
                      .reviewStatus !==
                      'ready' ||
                    draft
                      .productMatchStatus !==
                      'verified' ||
                    selectedRecord
                      .productMatchStatus !==
                      'verified' ||
                    draft.glassCode !==
                      selectedRecord
                        .glassCode ||
                    Number(
                      draft.productQuantity ||
                        0
                    ) !==
                      Number(
                        selectedRecord
                          .productQuantity ||
                          0
                      )
                  }
                >
                  {busy === 'submit'
                    ? 'Sending...'
                    : submissionEnabled
                      ? 'Send to Keith Tech'
                      : 'Submission Locked'}
                </button>
              </section>

              <details className="ejc-source-text">
                <summary>
                  View Original Job Card Text
                </summary>

                <pre>
                  {selectedRecord.rawText}
                </pre>
              </details>
            </>
          )}
        </main>
      </section>
    </Page>
  );
}
// END_VP_EXTERNAL_JOB_CARDS_DASHBOARD_V1


function WifiVouchersPage() {
  const WIFI_BASE = 'http://127.0.0.1:18764';
  const TOKEN_KEY = 'windscreen.wifi.receptionDesktopToken.live.v1';
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [pairCode, setPairCode] = useState('');
  const [pairing, setPairing] = useState(false);
  const [bridgeState, setBridgeState] = useState('checking');
  const [updateWatching, setUpdateWatching] = useState(false);
  const [wifiOnline, setWifiOnline] = useState(false);
  const [startingWifi, setStartingWifi] = useState(false);
  const [timeChoice, setTimeChoice] = useState(60);
  const [customTimeValue, setCustomTimeValue] = useState(45);
  const [customTimeUnit, setCustomTimeUnit] = useState('minutes');
  const [dataChoice, setDataChoice] = useState(1024);
  const [customDataValue, setCustomDataValue] = useState(750);
  const [customDataUnit, setCustomDataUnit] = useState('MB');
  const [generatingVoucher, setGeneratingVoucher] = useState(false);
  const [generatedVoucher, setGeneratedVoucher] = useState(null);
  const [selectedVoucherReceipt, setSelectedVoucherReceipt] = useState(null);
  const [vouchers, setVouchers] = useState([]);
  const [message, setMessage] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const [refreshingLive, setRefreshingLive] = useState(false);
  const [now, setNow] = useState(new Date());
  const [mode, setMode] = useState(() => localStorage.getItem('windscreenWifiPageMode') || 'light');
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const voucherGenerateAbortRef = useRef(null);

  const pick = (o, ...keys) => {
    for (const key of keys) {
      if (o && o[key] !== undefined && o[key] !== null && o[key] !== '') return o[key];
    }
    return '';
  };

  const friendlyState = (voucher) => {
    const raw = String(pick(voucher, 'state', 'lifecycleState', 'status') || 'Unknown');
    const state = raw.toLowerCase();
    if (state.includes('active') || state.includes('connected') || state.includes('usage started')) return 'Active';
    if (state.includes('unused') || state.includes('ready')) return 'Unused';
    if (state.includes('blocked') || state.includes('cancel')) return 'Cancelled';
    if (state.includes('deadline') || state.includes('expired')) return 'Expired';
    if (state.includes('used')) return 'Used';
    return raw;
  };

  const fmtBytes = (value) => {
    if (value === '' || value === null || value === undefined) return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
    return `${n} B`;
  };

  const voucherTime = (voucher) => {
    const secondsLeft = Number(voucher?.remainingSeconds);
    if (voucher?.remainingSeconds !== null && voucher?.remainingSeconds !== undefined && Number.isFinite(secondsLeft)) {
      const seconds = Math.max(0, Math.floor(secondsLeft));
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(seconds % 60).padStart(2, '0')}s`;
    }
    const explicit = pick(voucher, 'timeLeft', 'remainingTime', 'remainingMinutesText', 'minutesRemaining', 'timeRemaining');
    if (explicit) return explicit;
    const endValue = pick(voucher, 'end', 'expiresAt', 'expiry', 'endTime');
    if (!endValue) return '—';
    const normalized = typeof endValue === 'string' ? endValue.replace(' ', 'T') : endValue;
    const endMs = new Date(normalized).getTime();
    if (!Number.isFinite(endMs)) return '—';
    const seconds = Math.max(0, Math.floor((endMs - Date.now()) / 1000));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const sec = seconds % 60;
    return h > 0 ? `${h}h ${String(m).padStart(2,'0')}m` : `${m}m ${String(sec).padStart(2,'0')}s`;
  };
  const voucherData = (voucher) => pick(voucher, 'dataLeft', 'remainingData', 'remainingBytesText') || fmtBytes(pick(voucher, 'bytesRemaining', 'remainingBytes', 'dataRemainingBytes'));
  const voucherDevice = (voucher) => pick(voucher, 'deviceName', 'hostname', 'hostName', 'device', 'clientName') || '—';

  async function reportWifiDiagnostic(stage, details = {}) {
    try {
      await fetch('/api/windscreen-wifi/diagnostic/8d31a9c4e7', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: 'wifi-generator-live-v1',
          stage,
          ok: Boolean(details.ok),
          error: String(details.error || '').slice(0, 4000),
          diagnostic: JSON.stringify({
            watchdogHealthy: details.watchdogHealthy,
            connectorVersion: details.connectorVersion,
            buildVersion: details.buildVersion,
            selectedMinutes: details.selectedMinutes,
            selectedMb: details.selectedMb,
            responseStatus: details.responseStatus
          }).slice(0, 12000)
        })
      });
    } catch (_) {}
  }

  async function localCall(path, options = {}, auth = true) {
    const headers = { ...(options.headers || {}) };
    if (auth && tokenRef.current) headers.Authorization = `Bearer ${tokenRef.current}`;
    const response = await fetch(`${WIFI_BASE}${path}`, { ...options, headers, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      tokenRef.current = '';
      setToken('');
      throw new Error('Pairing required.');
    }
    if (!response.ok) {
      const error = new Error(data.error || 'Reception WiFi is unavailable.');
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  }

  async function probeBridge() {
    try {
      const health = await localCall('/health', {}, false);
      setBridgeState(health?.connectorDetected ? 'ready' : 'connector-offline');
      return health;
    } catch {
      setBridgeState('update-required');
      return null;
    }
  }

  async function refreshStatusAndVouchers(silent = false) {
    if (!tokenRef.current || (!silent && !markWifiUse())) return;
    try {
      const status = await localCall('/wifi/status');
      setBridgeState(status?.connectorDetected ? 'ready' : 'connector-offline');
      setWifiOnline(Boolean(status?.online));
      if (status?.online) {
        const data = await localCall('/vouchers');
        setVouchers(Array.isArray(data?.vouchers) ? data.vouchers : []);
        setLastUpdated(new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      }
      if (!silent) setMessage('');
    } catch (error) {
      if (!silent) setMessage(error.message || 'Reception WiFi is unavailable.');
    }
  }

  async function refreshLiveContainer() {
    if (!tokenRef.current || refreshingLive || !markWifiUse()) return;

    // This is deliberately NOT a browser/page refresh. It only resets the
    // voucher generator and reloads the Live voucher container.
    if (voucherGenerateAbortRef.current) {
      try { voucherGenerateAbortRef.current.abort(); } catch (_) {}
      voucherGenerateAbortRef.current = null;
    }
    setGeneratingVoucher(false);
    setMessage('');
    setRefreshingLive(true);

    try {
      const data = await localCall('/vouchers');
      setVouchers(Array.isArray(data?.vouchers) ? data.vouchers : []);
      setLastUpdated(new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (error) {
      setMessage(error.message || 'Could not refresh the voucher list.');
    } finally {
      setRefreshingLive(false);
    }
  }

  async function pairReceptionDesktop(event) {
    event?.preventDefault?.();
    const code = pairCode.replace(/\D/g, '').slice(0, 6);
    if (code.length !== 6) return setMessage('Enter the 6-digit Reception Connector code.');
    setPairing(true);
    setMessage('Pairing with the Reception Desktop…');
    try {
      const result = await localCall('/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      }, false);
      await new Promise(resolve => setTimeout(resolve, 1600));
      localStorage.setItem(TOKEN_KEY, result.token);
      tokenRef.current = result.token;
      setToken(result.token);
      setMessage('Reception Desktop connected.');
      await refreshStatusAndVouchers(true);
    } catch (error) {
      setMessage(error.message || 'Pairing failed.');
    } finally {
      setPairing(false);
    }
  }

  async function startGuestWifi() {
    if (!tokenRef.current || startingWifi) return;
    setStartingWifi(true);
    setMessage('Starting Reception Guest WiFi…');
    try {
      await localCall('/wifi/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      let online = false;
      for (let i = 0; i < 20; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        const status = await localCall('/wifi/status');
        if (status?.online) { online = true; break; }
      }
      setWifiOnline(online);
      setMessage(online ? '' : 'Guest WiFi is still off. Press Turn On Guest WiFi again.');
      if (online) await refreshStatusAndVouchers(true);
    } catch (error) {
      setMessage('Guest WiFi is still off. Press Turn On Guest WiFi again.');
    } finally {
      setStartingWifi(false);
    }
  }

  const selectedMinutes = () => {
    if (timeChoice !== 'custom') return Number(timeChoice);
    const value = Math.max(1, Number(customTimeValue) || 1);
    return customTimeUnit === 'hours' ? Math.round(value * 60) : Math.round(value);
  };

  const selectedMegabytes = () => {
    if (dataChoice !== 'custom') return Number(dataChoice);
    const value = Math.max(1, Number(customDataValue) || 1);
    return customDataUnit === 'GB' ? Math.round(value * 1024) : Math.round(value);
  };

  const newRequestKey = () => {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };

  const formatLimitTime = (minutes) => {
    if (minutes % 60 === 0) {
      const hours = minutes / 60;
      return hours === 1 ? '1 hour' : `${hours} hours`;
    }
    return `${minutes} min`;
  };

  const formatLimitData = (mb) => mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb} MB`;

  function markWifiUse() {
    const key = 'windscreenWifiLastUsedAt.v1';
    const last = Number(localStorage.getItem(key));
    if (last && (Date.now() - last >= 7 * 24 * 60 * 60 * 1000 || last > Date.now() + 60000)) {
      window.dispatchEvent(new Event('windscreen-wifi-pin-expired'));
      return false;
    }
    localStorage.setItem(key, String(Date.now()));
    return true;
  }

  async function generateWifiVoucher() {
    if (!wifiOnline || generatingVoucher || !markWifiUse()) return;

    const totalMinutes = selectedMinutes();
    const totalMb = selectedMegabytes();
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    let dataAmount = totalMb;
    let dataUnit = 'MB';
    if (dataChoice === 'custom') {
      dataAmount = Math.max(1, Number(customDataValue) || 1);
      dataUnit = customDataUnit === 'GB' ? 'GB' : 'MB';
    } else if (totalMb >= 1024 && totalMb % 1024 === 0) {
      dataAmount = totalMb / 1024;
      dataUnit = 'GB';
    }

    const payload = {
      hours,
      minutes,
      dataAmount,
      dataUnit,
      key: newRequestKey()
    };

    const controller = new AbortController();
    voucherGenerateAbortRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 10000);

    setGeneratingVoucher(true);
    setMessage('Creating voucher…');

    try {
      const result = await localCall('/vouchers', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const code = String(result?.code || result?.voucher?.code || '').trim();
      if (!/^\d{6}$/.test(code)) throw new Error('Voucher was not created. Please try again.');

      setGeneratedVoucher({
        code,
        time: formatLimitTime(totalMinutes),
        data: formatLimitData(totalMb),
        issuedAt: new Date().toISOString()
      });
      setMessage('');

      try {
        const data = await localCall('/vouchers');
        setVouchers(Array.isArray(data?.vouchers) ? data.vouchers : []);
        setLastUpdated(new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      } catch (_) {}
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setMessage(error?.message || 'Voucher could not be created.');
      }
    } finally {
      window.clearTimeout(timer);
      if (voucherGenerateAbortRef.current === controller) voucherGenerateAbortRef.current = null;
      setGeneratingVoucher(false);
    }
  }

  useEffect(() => {
    localStorage.setItem('windscreenWifiPageMode', mode);
  }, [mode]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    let alive = true;
    let timer = null;

    (async () => {
      const health = await probeBridge();
      if (!alive || !health) return;

      if (tokenRef.current) {
        await refreshStatusAndVouchers(true);
        timer = window.setInterval(() => {
          refreshStatusAndVouchers(true);
        }, 5000);
      }
    })();

    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
    };
  }, [token]);

  useEffect(() => {
    if (!updateWatching || tokenRef.current) return undefined;

    let cancelled = false;
    let attempts = 0;

    async function checkUpdatedConnector() {
      attempts += 1;
      const health = await probeBridge();
      if (cancelled) return;

      if (health?.connectorDetected) {
        setUpdateWatching(false);
        setMessage('Reception Desktop connected. Enter its 6-digit pairing code.');
        return;
      }

      if (attempts >= 90) {
        setUpdateWatching(false);
        setMessage('Setup has not been detected yet. Check the installer window, then press Recheck.');
      }
    }

    checkUpdatedConnector();
    const timer = window.setInterval(checkUpdatedConnector, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [updateWatching]);

  const numericDataRemaining = (voucher) => {
    const raw = pick(voucher, 'bytesRemaining', 'remainingBytes', 'dataRemainingBytes');
    if (raw !== '') {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }

    const text = String(voucherData(voucher) || '').trim().toUpperCase();
    const match = text.match(/^([0-9.]+)\s*(B|KB|MB|GB)$/);
    if (!match) return null;
    const value = Number(match[1]);
    const unit = match[2];
    const multiplier = unit === 'GB' ? 1024 ** 3 : unit === 'MB' ? 1024 ** 2 : unit === 'KB' ? 1024 : 1;
    return Number.isFinite(value) ? value * multiplier : null;
  };

  const hasTimeRemaining = (voucher) => {
    if (voucher?.remainingSeconds !== null && voucher?.remainingSeconds !== undefined && Number.isFinite(Number(voucher.remainingSeconds))) return Number(voucher.remainingSeconds) > 0;
    const text = String(voucherTime(voucher) || '').trim().toLowerCase();
    if (/^0m\s*0+s$/.test(text) || /^0h\s*0+m$/.test(text) || text === '0' || text === 'expired') return false;

    const endValue = pick(voucher, 'end', 'expiresAt', 'expiry', 'endTime');
    if (endValue) {
      const normalized = typeof endValue === 'string' ? endValue.replace(' ', 'T') : endValue;
      const endMs = new Date(normalized).getTime();
      if (Number.isFinite(endMs) && endMs <= Date.now()) return false;
    }

    return true;
  };

  const hasBeenRedeemed = (voucher) => Boolean(pick(voucher, 'firstUse', 'firstLogin', 'sessionStart'));

  const parsedTimeMs = value => {
    if (!value) return NaN;
    return Date.parse(String(value).replace(' ', 'T'));
  };

  const activationDeadlineMs = voucher => {
    const connectorDeadline = parsedTimeMs(pick(voucher, 'redeemBy'));
    if (Number.isFinite(connectorDeadline)) return connectorDeadline;
    const issued = parsedTimeMs(pick(voucher, 'issued', 'createdAt', 'createdDate', 'created'));
    return Number.isFinite(issued) ? issued + 5 * 60 * 1000 : NaN;
  };

  const activationSecondsLeft = voucher => {
    const deadline = activationDeadlineMs(voucher);
    return Number.isFinite(deadline) ? Math.max(0, Math.floor((deadline - now.getTime()) / 1000)) : 0;
  };

  const activationTimeText = voucher => {
    const seconds = activationSecondsLeft(voucher);
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  };

  const assignedTimeText = voucher => {
    const mins = Number(pick(voucher, 'assignedMinutes', 'rawMinutesCredit'));
    return Number.isFinite(mins) && mins > 0 ? formatLimitTime(mins) : voucherTime(voucher);
  };


  const assignedDataText = voucher => {
    const bytes = Number(pick(voucher, 'assignedBytes', 'bytesTrafficCredit', 'dataLimitBytes'));
    if (Number.isFinite(bytes) && bytes > 0) return fmtBytes(bytes);
    return voucherData(voucher);
  };

  const voucherIssuedText = voucher => pick(voucher, 'issued', 'createdAt', 'createdDate', 'created', 'issueTime') || new Date().toISOString();

  async function openVoucherReceipt(voucher) {
    const code = String(pick(voucher, 'code') || '').trim();
    if (!/^\d{6}$/.test(code)) return;
    setSelectedVoucherReceipt({
      code,
      time: assignedTimeText(voucher),
      data: assignedDataText(voucher),
      issuedAt: voucherIssuedText(voucher),
      status: isReadyVoucher(voucher) ? 'READY' : 'ACTIVE',
      device: voucherDevice(voucher)
    });
  }

  function printVoucherReceipt(voucherData) {
    if (!voucherData) return;

    // Print in an isolated receipt window so printing can never reload,
    // reset, or navigate the Windscreen dashboard itself.
    const code = String(voucherData.code || '').trim();
    if (!/^\d{6}$/.test(code)) {
      setMessage('This voucher does not have a valid six-digit code.');
      return;
    }

    const accessTime = vpEscapeHtml(String(voucherData.time || '—'));
    const dataLimit = vpEscapeHtml(String(voucherData.data || '—'));
    const issued = vpEscapeHtml(new Date(voucherData.issuedAt || Date.now()).toLocaleString());
    const safeCode = vpEscapeHtml(code);

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>WiFi Voucher ${safeCode}</title>
  <style>
    @page { size: 58mm auto; margin: 2mm; }
    html, body { width: 54mm; margin: 0; padding: 0; background: #fff; color: #000; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; line-height: 1.25; }
    .receipt { width: 54mm; box-sizing: border-box; padding: 1mm 0; }
    .brand { text-align: center; font-weight: 900; font-size: 11pt; }
    .title { text-align: center; font-weight: 800; font-size: 9pt; margin-top: 1.5mm; }
    .rule { border-top: 1px dashed #000; margin: 2.5mm 0; }
    .label { text-align: center; font-size: 8pt; font-weight: 700; }
    .code { text-align: center; font-weight: 900; font-size: 23pt; letter-spacing: .10em; margin: 1.5mm 0 2mm; }
    .row { display: flex; justify-content: space-between; gap: 2mm; margin: 1.5mm 0; font-size: 8.5pt; }
    .row strong { text-align: right; }
    .note { text-align: center; font-size: 7.5pt; margin: 1.5mm 0; }
    .thanks { text-align: center; font-weight: 900; margin-top: 3mm; }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="brand">WINDSCREEN FITMENT CENTRE</div>
    <div class="title">CUSTOMER WIFI VOUCHER</div>
    <div class="rule"></div>
    <div class="label">VOUCHER CODE</div>
    <div class="code">${safeCode}</div>
    <div class="rule"></div>
    <div class="row"><span>Access time</span><strong>${accessTime}</strong></div>
    <div class="row"><span>Data limit</span><strong>${dataLimit}</strong></div>
    <div class="row"><span>Issued</span><strong>${issued}</strong></div>
    <div class="rule"></div>
    <div class="note">Connect to Windscreen Guest Wifi.</div>
    <div class="note">Enter the 6-digit voucher code.</div>
    <div class="note">Time starts when the customer connects.</div>
    <div class="thanks">THANK YOU</div>
  </div>
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 120);
    });
    window.addEventListener('afterprint', function () { window.close(); });
  <\/script>
</body>
</html>`;

    const receiptWindow = window.open('', 'windscreen_wifi_receipt', 'width=420,height=720');
    if (!receiptWindow) {
      setMessage('Printing was blocked by the browser. Allow pop-ups for this dashboard and press Print Receipt again.');
      return;
    }

    receiptWindow.document.open();
    receiptWindow.document.write(html);
    receiptWindow.document.close();
  }

  const isReadyVoucher = voucher => {
    if (hasBeenRedeemed(voucher)) return false;
    const state = String(pick(voucher, 'lifecycleState', 'state', 'status') || '').toLowerCase();
    if (/blocked|cancel|expired|deadline passed|late login|finished|ended/.test(state)) return false;
    const deadline = activationDeadlineMs(voucher);
    return Number.isFinite(deadline) ? deadline > now.getTime() : /waiting|unused/.test(state);
  };

  const isActiveVoucher = voucher => {
    if (!hasBeenRedeemed(voucher)) return false;
    const state = String(pick(voucher, 'lifecycleState', 'state', 'status') || '').toLowerCase();
    if (/blocked|cancel|expired|deadline passed|late login|finished|ended/.test(state)) return false;
    const remaining = numericDataRemaining(voucher);
    if (remaining !== null && remaining <= 0) return false;
    if (!hasTimeRemaining(voucher)) return false;
    return /usage started|active|connected/.test(state);
  };

  const isLiveVoucher = voucher => isReadyVoucher(voucher) || isActiveVoucher(voucher);

  const historyStatus = voucher => {
    const state = String(pick(voucher, 'lifecycleState', 'state', 'status') || '').toLowerCase();
    if (/blocked|cancel/.test(state)) return 'Cancelled';
    if (!hasBeenRedeemed(voucher)) return 'Expired';
    return 'Used';
  };

  const managedVouchers = vouchers.filter(voucher => voucher?.managed !== false);
  const liveVouchers = managedVouchers.filter(isLiveVoucher);
  const historyVouchers = managedVouchers.filter(voucher => !isLiveVoucher(voucher));
  const waiting = liveVouchers.filter(isReadyVoucher).length;
  const active = liveVouchers.filter(isActiveVoucher).length;
  const completed = historyVouchers.length;

  return (
    <div className={cx('wifi-studio-page', mode === 'dark' && 'wifi-page-dark')}>
      <section className="wifi-studio-hero">
        <div className="wifi-studio-hero-copy">
          <div className="wifi-studio-kicker"><Wifi size={16} /> RECEPTION CUSTOMER WIFI</div>
          <h1>WiFi Vouchers</h1>
          <p>Turn on Reception Guest WiFi, issue customer access and monitor active voucher usage from one staff-friendly screen.</p>
          <div className="wifi-live-clock">
            <span>{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
            <strong>{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong>
          </div>
          <div className="wifi-page-theme-toggle" aria-label="WiFi page appearance">
            <button type="button" className={mode === 'light' ? 'active' : ''} onClick={() => setMode('light')}><Sun size={15}/> Daylight</button>
            <button type="button" className={mode === 'dark' ? 'active' : ''} onClick={() => setMode('dark')}><Moon size={15}/> Dark</button>
          </div>
        </div>
        <div className="wifi-studio-hero-art" aria-hidden="true">
          <div className="wifi-art-glow" />
          <Wifi className="wifi-art-icon" size={168} strokeWidth={1.2} />
          <div className="wifi-art-logo"><SafeLogo src={W_LOGO} className="wifi-art-logo-img" fallback="WF" /></div>
          <span>Customer WiFi</span>
        </div>
      </section>



      {bridgeState === 'checking' ? (
        <section className="wifi-connection-card">
          <div className="wifi-connection-icon"><RefreshCw size={24}/></div>
          <div>
            <span className="wifi-card-eyebrow">RECEPTION DESKTOP</span>
            <h2>Checking Reception WiFi connection…</h2>
            <p>This check runs once. The Windscreen dashboard will not reload.</p>
          </div>
        </section>
      ) : bridgeState === 'update-required' ? (
        <section className="wifi-connection-card warning">
          <div className="wifi-connection-icon"><AlertTriangle size={24}/></div>
          <div>
            <span className="wifi-card-eyebrow">RECEPTION DESKTOP SETUP</span>
            <h2>Set up customer WiFi on this computer</h2>
            <p>Open Settings → WiFi Voucher System Setup Guide and complete the Reception Desktop setup once.</p>
            <p>Download and run Reception Setup below. It prepares Python automatically, installs the connector, and shows the six-digit pairing code.</p>
            <p>After setup, the Reception WiFi service opens at Windows sign-in. Staff can start the guest network from the reception computer if required.</p>
          </div>
          {updateWatching ? (
            <button type="button" className="wifi-primary-button" disabled>Waiting for setup…</button>
          ) : (
            <a
              className="wifi-primary-link"
              href="/files/downloads/Install-Windscreen-Reception-WiFi-Portable-v3.cmd"
              download
              onClick={() => {
                setUpdateWatching(true);
                setMessage('Run the downloaded Reception Setup on this Windows desktop, then return here.');
              }}
            >
              Download Reception Setup
            </a>
          )}
        </section>
      ) : bridgeState === 'connector-offline' ? (
        <section className="wifi-connection-card warning">
          <div className="wifi-connection-icon"><AlertTriangle size={24}/></div>
          <div>
            <span className="wifi-card-eyebrow">RECEPTION DESKTOP</span>
            <h2>Reception WiFi Connector is offline</h2>
            <p>Run Reception Setup on this computer. It installs the connector and prepares the Reception WiFi service for Windows sign-in.</p><a href="/files/downloads/Install-Windscreen-Reception-WiFi-Portable-v3.cmd" download>Download Reception Setup</a>
          </div>
          <button type="button" className="wifi-primary-button" onClick={() => {
            setBridgeState('checking');
            probeBridge();
          }}>Recheck</button>
        </section>
      ) : !token ? (
        <form className="wifi-pair-card" onSubmit={pairReceptionDesktop}>
          <div className="wifi-connection-icon"><Lock size={24}/></div>
          <div className="wifi-pair-copy">
            <span className="wifi-card-eyebrow">RECEPTION DESKTOP</span>
            <h2>Enter the desktop's 6-digit pairing code</h2>
            <p>The installer shows this code on the reception desktop. Pair once here; the dashboard admin PIN will be requested again after 7 days without opening WiFi Vouchers.</p>
          </div>
          <input value={pairCode} onChange={e => setPairCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} placeholder="000000" aria-label="6-digit connector code" />
          <button type="submit" className="wifi-primary-button" disabled={pairing}>{pairing ? 'Pairing…' : 'Connect Reception Desktop'}</button>
        </form>
      ) : (
        <>
          {!wifiOnline && (
            <section className="wifi-power-card">
              <div className="wifi-power-state">
                <div className="wifi-power-dot" />
                <div>
                  <span>RECEPTION WIFI</span>
                  <h2>Reception Guest WiFi is Off</h2>
                  <p>Start the Reception Guest WiFi service on this computer, then check the connection here.</p>
                </div>
              </div>
              <button type="button" className="wifi-primary-button" onClick={() => refreshStatusAndVouchers(false)}>Check hotspot</button>
            </section>
          )}

          {wifiOnline && (
            <>
              <section className="wifi-create-grid wifi-create-grid-single">
                <article className="wifi-panel wifi-create-card">
                  <div className="wifi-panel-head">
                    <div>
                      <span>NEW CUSTOMER ACCESS</span>
                      <h2>Create WiFi Voucher</h2>
                      <p>Choose the customer's access time and data allowance.</p>
                    </div>
                  </div>

                  <div className="wifi-limit-field">
                    <label>ACCESS TIME</label>
                    <div className="wifi-choice-row">
                      {[['5 min',5],['30 min',30],['1 hour',60],['2 hours',120],['Custom','custom']].map(([label,value]) => (
                        <button key={String(value)} type="button" className={timeChoice === value ? 'active' : ''} onClick={() => setTimeChoice(value)}>{label}</button>
                      ))}
                    </div>
                    {timeChoice === 'custom' && (
                      <div className="wifi-custom-row">
                        <input type="number" min="1" value={customTimeValue} onChange={e => setCustomTimeValue(e.target.value)} />
                        <select value={customTimeUnit} onChange={e => setCustomTimeUnit(e.target.value)}>
                          <option value="minutes">minutes</option>
                          <option value="hours">hours</option>
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="wifi-limit-field">
                    <label>DATA LIMIT</label>
                    <div className="wifi-choice-row">
                      {[['250 MB',250],['500 MB',500],['1 GB',1024],['2 GB',2048],['Custom','custom']].map(([label,value]) => (
                        <button key={String(value)} type="button" className={dataChoice === value ? 'active' : ''} onClick={() => setDataChoice(value)}>{label}</button>
                      ))}
                    </div>
                    {dataChoice === 'custom' && (
                      <div className="wifi-custom-row">
                        <input type="number" min="1" value={customDataValue} onChange={e => setCustomDataValue(e.target.value)} />
                        <select value={customDataUnit} onChange={e => setCustomDataUnit(e.target.value)}>
                          <option value="MB">MB</option>
                          <option value="GB">GB</option>
                        </select>
                      </div>
                    )}
                  </div>

                  <button type="button" className={cx('wifi-generate-button', generatingVoucher && 'busy')} onClick={generateWifiVoucher}>
                    {generatingVoucher ? 'Creating WiFi Voucher…' : 'Generate WiFi Voucher'}
                  </button>
                  <p className="wifi-create-note">The 6-digit code is created in the Reception WiFi system and appears immediately below.</p>
                  {message && <div className={cx('wifi-create-feedback', !generatingVoucher && 'error')}>{message}</div>}
                </article>
              </section>

              <section className="wifi-stats-grid">
                <article><span>READY</span><strong>{waiting}</strong><small>waiting for customer</small></article>
                <article className="active"><span>ACTIVE</span><strong>{active}</strong><small>customers online now</small></article>
                <article><span>HISTORY</span><strong>{completed}</strong><small>used or expired</small></article>
                <article><span>LIVE REFRESH</span><strong>5 sec</strong><small>{lastUpdated ? `Last ${lastUpdated}` : 'waiting for first update'}</small></article>
              </section>

              <section className="wifi-panel">
                <div className="wifi-panel-head">
                  <div><span>LIVE</span><h2>Ongoing Vouchers</h2><p>New vouchers and active customer sessions refresh every 5 seconds.</p></div>
                  <button type="button" onClick={refreshLiveContainer} disabled={refreshingLive}><RefreshCw size={15} className={refreshingLive ? 'wifi-spin' : ''}/> {refreshingLive ? 'Refreshing…' : 'Refresh now'}</button>
                </div>
                {generatedVoucher && (
                  <div className="wifi-inline-voucher" aria-live="polite">
                    <div><span className="wifi-card-eyebrow">NEW VOUCHER — GIVE TO CUSTOMER</span><strong>{generatedVoucher.code}</strong><p>{generatedVoucher.time} · {generatedVoucher.data} · Activate within 5 min · Time starts on first use</p></div>
                    <div className="wifi-inline-actions">
                      <button type="button" onClick={() => printVoucherReceipt(generatedVoucher)}>Print receipt</button>
                      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(generatedVoucher.code); setMessage('Voucher code copied.'); } catch { setMessage('Copy the six-digit code shown above.'); } }}>Copy code</button>
                      <button type="button" onClick={() => setGeneratedVoucher(null)}>Dismiss</button>
                    </div>
                  </div>
                )}
                {liveVouchers.length ? (
                  <div className="wifi-active-grid">
                    {liveVouchers.map(voucher => (
                      <article
                        key={String(pick(voucher, 'id', 'code'))}
                        className="wifi-voucher-card-clickable"
                        role="button"
                        tabIndex={0}
                        title="Click to view and print this voucher"
                        onClick={() => openVoucherReceipt(voucher)}
                        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openVoucherReceipt(voucher); } }}
                      >
                        <div className="wifi-voucher-top"><code>{pick(voucher, 'code') || '------'}</code><span>{hasBeenRedeemed(voucher) ? 'ACTIVE' : 'READY'}</span></div>
                        <p>{voucherDevice(voucher)}</p>
                        {isReadyVoucher(voucher) ? (
                          <div className="wifi-voucher-metrics ready"><div><span>ACTIVATE WITHIN</span><strong>{activationTimeText(voucher)}</strong></div><div><span>TIME LIMIT</span><strong>{assignedTimeText(voucher)}</strong></div><div><span>DATA LIMIT</span><strong>{voucherData(voucher)}</strong></div></div>
                        ) : (
                          <div className="wifi-voucher-metrics"><div><span>TIME LEFT</span><strong>{voucherTime(voucher)}</strong></div><div><span>DATA LEFT</span><strong>{voucherData(voucher)}</strong></div></div>
                        )}
                      </article>
                    ))}
                  </div>
                ) : <div className="wifi-empty-state">No ongoing vouchers right now.</div>}
                <section className="wifi-history-section">
                  <div className="wifi-panel-head"><div><span>USED ACCESS</span><h2>Voucher History</h2><p>Used vouchers and unused vouchers that expired after 5 minutes.</p></div></div>
                <div className="wifi-table-wrap">
                  <table><thead><tr><th>Code</th><th>Status</th><th>Device</th><th>Time left</th><th>Data left</th><th>Created</th></tr></thead>
                    <tbody>{historyVouchers.slice(0, 50).map(voucher => {
                      const state = historyStatus(voucher);
                      return <tr key={String(pick(voucher, 'id', 'code'))}><td><code>{pick(voucher, 'code') || '------'}</code></td><td><span className={cx('wifi-status-pill', state.toLowerCase())}>{state}</span></td><td>{voucherDevice(voucher)}</td><td>{state === 'Expired' ? '0m 00s' : voucherTime(voucher)}</td><td>{state === 'Expired' ? 'Not used' : voucherData(voucher)}</td><td>{pick(voucher, 'createdDate', 'createdAt', 'created', 'issueTime', 'issued') || '—'}</td></tr>;
                    })}</tbody>
                  </table>
                  {!historyVouchers.length && <div className="wifi-empty-state">No used or expired vouchers yet.</div>}
                </div>
                </section>
              </section>
            </>
          )}
        </>
      )}

      {selectedVoucherReceipt && (
        <div className="wifi-voucher-print-overlay" role="dialog" aria-modal="true" aria-label="WiFi voucher receipt">
          <div className="wifi-voucher-print-card">
            <button type="button" className="wifi-print-close" onClick={() => setSelectedVoucherReceipt(null)} aria-label="Close">×</button>
            <span className="wifi-card-eyebrow">WIFI VOUCHER</span>
            <h2>{selectedVoucherReceipt.code}</h2>
            <div className="wifi-print-summary">
              <div><span>STATUS</span><strong>{selectedVoucherReceipt.status || 'READY'}</strong></div>
              <div><span>TIME LIMIT</span><strong>{selectedVoucherReceipt.time}</strong></div>
              <div><span>DATA LIMIT</span><strong>{selectedVoucherReceipt.data}</strong></div>
              <div><span>DEVICE</span><strong>{selectedVoucherReceipt.device || '—'}</strong></div>
            </div>
            <p className="wifi-print-hint">Receipt format is prepared for a 58 mm thermal printer.</p>
            <div className="wifi-result-actions">
              <button type="button" className="receipt" onClick={() => printVoucherReceipt(selectedVoucherReceipt)}>Print Receipt</button>
              <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(selectedVoucherReceipt.code); setMessage('Voucher code copied.'); } catch { setMessage('Copy the six-digit code shown above.'); } }}>Copy Code</button>
              <button type="button" className="primary" onClick={() => setSelectedVoucherReceipt(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {message && <div className="wifi-inline-message">{message}</div>}
      {(selectedVoucherReceipt || generatedVoucher) && (() => {
        const receipt = selectedVoucherReceipt || generatedVoucher;
        return <div className="wifi-thermal-receipt" aria-hidden="true">
              <div className="wifi-receipt-brand">WINDSCREEN FITMENT CENTRE</div>
              <div className="wifi-receipt-title">CUSTOMER WIFI VOUCHER</div>
              <div className="wifi-receipt-rule">------------------------</div>
              <div className="wifi-receipt-label">VOUCHER CODE</div>
              <div className="wifi-receipt-code">{receipt.code}</div>
              <div className="wifi-receipt-rule">------------------------</div>
              <div className="wifi-receipt-row"><span>Access time</span><strong>{receipt.time}</strong></div>
              <div className="wifi-receipt-row"><span>Data limit</span><strong>{receipt.data}</strong></div>
              <div className="wifi-receipt-row"><span>Issued</span><strong>{new Date(receipt.issuedAt || Date.now()).toLocaleString()}</strong></div>
              <div className="wifi-receipt-rule">------------------------</div>
              <div className="wifi-receipt-note">Connect to Windscreen Guest Wifi.</div>
              <div className="wifi-receipt-note">Enter the 6-digit voucher code.</div>
              <div className="wifi-receipt-note">Time starts when the customer connects.</div>
              <div className="wifi-receipt-thanks">THANK YOU</div>
            </div>;
      })()}
    </div>
  );
}

function App() {
  const [theme, setTheme] = useTheme();
  const WIFI_LAST_USE_KEY = 'windscreenWifiLastUsedAt.v1';
  const WIFI_PIN_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
  const [pin, setPin] = useState(() => {
    const saved = localStorage.getItem('studioPin') || '';
    if (!saved) return '';
    const last = Number(localStorage.getItem(WIFI_LAST_USE_KEY));
    if (!last) {
      localStorage.setItem(WIFI_LAST_USE_KEY, String(Date.now()));
      return saved;
    }
    if (Date.now() - last >= WIFI_PIN_TIMEOUT_MS || last > Date.now() + 60000) {
      localStorage.removeItem('studioPin');
      return '';
    }
    return saved;
  });
  const [active, setActive] = useState('dashboard');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [autoRefreshEnabled, setAutoRefreshState] = useState(() => {
    const current = localStorage.getItem('studioAutoRefresh1m');
    if (current !== null) return current !== 'false';
    return localStorage.getItem('studioAutoRefresh10s') !== 'false';
  });
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastRefreshAt, setLastRefreshAt] = useState('');
  const backgroundRefreshBusy = useRef(false);

  async function api(path, method = 'GET', body) {
    const res = await fetch(`/api/studio/v3${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-admin-pin': pin },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) {
      const error = new Error(json.error || 'Request failed');
      error.status = res.status;
      throw error;
    }
    return json;
  }

  async function load(options = {}) {
    const background = options?.background === true;
    if (background && backgroundRefreshBusy.current) return;
    if (background) backgroundRefreshBusy.current = true;

    try {
      if (!background) setError('');
      const next = await api('/state');
      setData(next);
      setLastRefreshAt(new Date().toISOString());
      setRefreshTick(value => value + 1);
    } catch (e) {
      if (!background) setError(e.message);
      if (e.message === 'Invalid or missing admin PIN.') {
        setData(null);
        setError(e.message);
      }
    } finally {
      if (background) backgroundRefreshBusy.current = false;
    }
  }

  useEffect(() => {
    if (pin) load();
  }, [pin]);

  useEffect(() => {
    if (!pin || !autoRefreshEnabled) return undefined;
    const timer = window.setInterval(() => {
      load({ background: true });
    }, 60000);
    return () => window.clearInterval(timer);
  }, [pin, autoRefreshEnabled]);

  useEffect(() => {
    if (!pin) return undefined;
    const timer = window.setInterval(() => {
      const last = Number(localStorage.getItem(WIFI_LAST_USE_KEY));
      if (last && (Date.now() - last >= WIFI_PIN_TIMEOUT_MS || last > Date.now() + 60000)) {
        localStorage.removeItem('studioPin');
        setPin('');
        setData(null);
        setError('');
      }
    }, 60000);
    return () => window.clearInterval(timer);
  }, [pin]);

  useEffect(() => {
    function requirePin() {
      localStorage.removeItem('studioPin');
      setPin('');
      setData(null);
    }
    window.addEventListener('windscreen-wifi-pin-expired', requirePin);
    return () => window.removeEventListener('windscreen-wifi-pin-expired', requirePin);
  }, []);

  useEffect(() => {
    if (pin && active === 'wifi' && data) {
      const last = Number(localStorage.getItem(WIFI_LAST_USE_KEY));
      if (last && Date.now() - last >= WIFI_PIN_TIMEOUT_MS) {
        localStorage.removeItem('studioPin');
        setPin('');
        setData(null);
      } else {
        localStorage.setItem(WIFI_LAST_USE_KEY, String(Date.now()));
      }
    }
  }, [pin, active, Boolean(data)]);

  function setAutoRefreshEnabled(enabled) {
    const next = Boolean(enabled);
    localStorage.setItem('studioAutoRefresh1m', next ? 'true' : 'false');
    localStorage.removeItem('studioAutoRefresh10s');
    setAutoRefreshState(next);
    if (next && pin) load({ background: true });
  }

  function login(v) {
    localStorage.setItem('studioPin', v);
    localStorage.setItem(WIFI_LAST_USE_KEY, String(Date.now()));
    setPin(v);
  }

  function logout() {
    localStorage.removeItem('studioPin');
    localStorage.removeItem(WIFI_LAST_USE_KEY);
    setPin('');
    setData(null);
    setError('');
  }

  if (!pin || error === 'Invalid or missing admin PIN.') return <Login onLogin={login} />;
  if (!data) return <Loading error={error} reset={logout} />;

  const pages = {
    dashboard: <PremiumDashboardPage data={data} setActive={setActive} />,
    schedule: <SchedulePage data={data} setActive={setActive} />,
    pipeline: <PipelinePage data={data} api={api} reload={load} />,
    reports: <ReportsPage data={data} />,
    activity: <ActivityPage api={api} refreshTick={refreshTick} />,
    team: <TeamPage api={api} data={data} refreshTick={refreshTick} />,
    parts: <PartsPage api={api} refreshTick={refreshTick} />,
    payments: <PaymentsPage data={data} api={api} reload={load} refreshTick={refreshTick} />,
    tasks: <TasksPage data={data} api={api} reload={load} refreshTick={refreshTick} />,
    documents: <DocumentsPage data={data} api={api} refreshTick={refreshTick} />,
    bookings: <ExactBookingsPage data={data} api={api} reload={load} refreshTick={refreshTick} />,
    quotes: <WorkPage title="Quotations" sub="Create, send, revise and track customer quotations." rows={data.quotes || []} type="Quote" api={api} reload={load} refreshTick={refreshTick} />,
    claims: <Claims data={data} api={api} reload={load} />,
    jobs: <MonthlyJobsPage api={api} reload={load} refreshTick={refreshTick} />,
    customers: <Customers data={data} api={api} reload={load} />,
    'external-job-cards': <ExternalJobCardsPage api={api} refreshTick={refreshTick} />,
    wifi: <WifiVouchersPage />,
    settings: <Settings data={data} api={api} reload={load} logout={logout} theme={theme} setTheme={setTheme} autoRefreshEnabled={autoRefreshEnabled} setAutoRefreshEnabled={setAutoRefreshEnabled} lastRefreshAt={lastRefreshAt} />
  };

  return (
    <Shell active={active} setActive={setActive} logout={logout}>
      {pages[active]}
    </Shell>
  );
}

createRoot(document.getElementById('root')).render(<App />);



// VP_DASHBOARD_LOWER_NEON_PATCH
if (typeof window !== "undefined" && !window.__vpDashboardLowerNeonPatch) {
  window.__vpDashboardLowerNeonPatch = true;

  const vpApplyDashboardLowerNeon = () => {
    const targets = ["Latest Insurance Claims", "Latest Customers"];
    const nodes = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,div,span"));

    nodes.forEach((el) => {
      const text = (el.textContent || "").trim();
      if (!targets.includes(text)) return;

      let current = el;
      for (let i = 0; i < 8 && current; i += 1) {
        current = current.parentElement;
        if (!current) break;

        const rect = current.getBoundingClientRect();
        const childCount = current.querySelectorAll("*").length;

        if (
          rect.width > 320 &&
          rect.height > 180 &&
          childCount > 12
        ) {
          current.classList.add("vp-dashboard-neon-panel");
          break;
        }
      }
    });
  };

  const vpRun = () => {
    requestAnimationFrame(() => {
      setTimeout(vpApplyDashboardLowerNeon, 50);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", vpRun);
  } else {
    vpRun();
  }

  window.addEventListener("load", vpRun);

  const obs = new MutationObserver(() => vpRun());
  const startObs = () => {
    if (document.body) {
      obs.observe(document.body, { childList: true, subtree: true });
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObs);
  } else {
    startObs();
  }
}




// VP_DASHBOARD_BUTTON_UI_PATCH_V1
if (typeof window !== "undefined" && !window.__vpDashboardButtonUiPatchV1) {
  window.__vpDashboardButtonUiPatchV1 = true;

  const vpDashboardButtonMatchers = [
    /^open claims$/i,
    /^open customers$/i,
    /^view all claims$/i,
    /^view all customers$/i
  ];

  const vpApplyDashboardButtonUi = () => {
    const nodes = Array.from(document.querySelectorAll("button, a"));

    nodes.forEach((el) => {
      const text = (el.textContent || "").trim().replace(/\s+/g, " ");
      if (!text) return;

      if (el.closest("aside, nav, [role='navigation']")) return;
      if (!vpDashboardButtonMatchers.some((rx) => rx.test(text))) return;

      el.classList.add("vp-dashboard-btn-ui");

      const disabled =
        el.hasAttribute("disabled") ||
        el.getAttribute("aria-disabled") === "true" ||
        el.classList.contains("disabled");

      if (disabled) {
        el.classList.add("vp-dashboard-btn-ui-disabled");
      } else {
        el.classList.remove("vp-dashboard-btn-ui-disabled");
      }
    });
  };

  const vpRunDashboardButtonUi = () => {
    requestAnimationFrame(() => {
      setTimeout(vpApplyDashboardButtonUi, 50);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", vpRunDashboardButtonUi);
  } else {
    vpRunDashboardButtonUi();
  }

  window.addEventListener("load", vpRunDashboardButtonUi);

  const vpObs = new MutationObserver(() => vpRunDashboardButtonUi());
  const vpStartObs = () => {
    if (document.body) {
      vpObs.observe(document.body, { childList: true, subtree: true });
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", vpStartObs);
  } else {
    vpStartObs();
  }
}



// VP_ACTIVITY_TAB_DOM_POLISH_V2
if (typeof window !== "undefined" && !window.__vpActivityTabDomPolishV2) {
  window.__vpActivityTabDomPolishV2 = true;

  const vpText = (el) => (el?.textContent || "").trim().replace(/\s+/g, " ");

  const vpFindActivityShell = () => {
    const labels = Array.from(document.querySelectorAll("*")).filter((el) => {
      return vpText(el).toUpperCase() === "SEARCH ACTIVITY";
    });

    for (const label of labels) {
      let current = label;
      for (let i = 0; i < 8 && current; i += 1) {
        const text = vpText(current);
        const rect = current.getBoundingClientRect();

        if (
          text.includes("Refresh Activity") &&
          text.includes("Export Activity CSV") &&
          rect.width > 600 &&
          rect.height > 140
        ) {
          return current;
        }

        current = current.parentElement;
      }
    }

    return null;
  };

  const vpCreateStatSvg = (type) => {
    if (type === "task") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11l3 3 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    if (type === "booking") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v4M16 3v4M4 10h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="4" y="5" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
    }

    if (type === "system") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 12l2 2 4-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  };

  const vpApplyActivityPolish = () => {
    const activityHeading = Array.from(document.querySelectorAll("h1")).find((el) => {
      return vpText(el) === "Activity";
    });

    document.body.classList.toggle("vp-activity-polish-active", Boolean(activityHeading));

    if (!activityHeading) return;

    // VP_ACTIVITY_NATIVE_CONSOLE_BYPASS_V2
    // The new Activity console is styled natively. Avoid the legacy DOM scan
    // across hundreds of audit rows and thousands of timestamp descendants.
    if (document.querySelector('.activity-audit-console')) {
      document.body.classList.remove('vp-activity-polish-active');
      return;
    }

    const shell = vpFindActivityShell();
    if (!shell) return;

    shell.classList.add("vp-activity-shell-polished");

    const searchLabel = Array.from(shell.querySelectorAll("*")).find((el) => {
      return vpText(el).toUpperCase() === "SEARCH ACTIVITY";
    });

    if (searchLabel) {
      let toolbar = searchLabel.parentElement;
      for (let i = 0; i < 5 && toolbar; i += 1) {
        const text = vpText(toolbar);
        if (text.includes("TYPE") && text.match(/\d+\s+records/i)) {
          toolbar.classList.add("vp-activity-filter-polished");
          break;
        }
        toolbar = toolbar.parentElement;
      }
    }

    Array.from(shell.querySelectorAll("button")).forEach((btn) => {
      const text = vpText(btn);
      if (/Refresh Activity|Export Activity CSV|Print Activity/i.test(text)) {
        btn.classList.add("vp-activity-action-btn");
      }
    });

    const countNode = Array.from(shell.querySelectorAll("*")).find((el) => {
      return /^\d+\s+records$/i.test(vpText(el));
    });

    if (countNode) {
      countNode.classList.add("vp-activity-record-count");
    }

    const stampNodes = Array.from(shell.querySelectorAll("*")).filter((el) => {
      return /\d{4}-\d{2}-\d{2}T/.test(vpText(el));
    });

    const cards = [];

    stampNodes.forEach((stamp) => {
      stamp.classList.add("vp-activity-time-polished");

      let current = stamp.parentElement;

      for (let i = 0; i < 8 && current; i += 1) {
        const rect = current.getBoundingClientRect();

        if (
          rect.width > 620 &&
          rect.height >= 70 &&
          rect.height < 180 &&
          !current.classList.contains("vp-activity-card-polished")
        ) {
          current.classList.add("vp-activity-card-polished");

          const allText = vpText(current).toLowerCase();

          if (allText.includes("task")) current.classList.add("is-task");
          else if (allText.includes("booking")) current.classList.add("is-booking");
          else if (allText.includes("job")) current.classList.add("is-job");
          else if (allText.includes("claim")) current.classList.add("is-claim");
          else current.classList.add("is-general");

          const iconBox = current.querySelector("svg")?.closest("div");
          if (iconBox) iconBox.classList.add("vp-activity-icon-polished");

          cards.push(current);
          break;
        }

        current = current.parentElement;
      }
    });

    const taskCount = cards.filter((card) => card.classList.contains("is-task")).length;
    const bookingCount = cards.filter((card) => card.classList.contains("is-booking")).length;
    const jobCount = cards.filter((card) => card.classList.contains("is-job") || card.classList.contains("is-claim")).length;
    const total = countNode ? parseInt(vpText(countNode), 10) || cards.length : cards.length;

    const headingParent = activityHeading.parentElement;

    if (headingParent && !document.querySelector(".vp-activity-stats-polished")) {
      const stats = document.createElement("section");
      stats.className = "vp-activity-stats-polished";
      stats.innerHTML = `
        <article>
          <div>${vpCreateStatSvg("total")}</div>
          <span>Total Records</span>
          <strong>${total}</strong>
          <p>All workflow activity captured by the dashboard.</p>
        </article>
        <article>
          <div>${vpCreateStatSvg("task")}</div>
          <span>Task Events</span>
          <strong>${taskCount}</strong>
          <p>Task creation, completion and follow-up movement.</p>
        </article>
        <article>
          <div>${vpCreateStatSvg("booking")}</div>
          <span>Booking Events</span>
          <strong>${bookingCount}</strong>
          <p>WhatsApp bookings and manual booking changes.</p>
        </article>
        <article>
          <div>${vpCreateStatSvg("system")}</div>
          <span>Operations</span>
          <strong>${jobCount}</strong>
          <p>Jobs, claims and important workflow updates.</p>
        </article>
      `;

      headingParent.insertAdjacentElement("afterend", stats);
    } else {
      const stats = document.querySelector(".vp-activity-stats-polished");
      if (stats) {
        const values = stats.querySelectorAll("strong");
        if (values[0]) values[0].textContent = String(total);
        if (values[1]) values[1].textContent = String(taskCount);
        if (values[2]) values[2].textContent = String(bookingCount);
        if (values[3]) values[3].textContent = String(jobCount);
      }
    }
  };

  const vpRunActivityPolish = () => {
    requestAnimationFrame(() => {
      setTimeout(vpApplyActivityPolish, 80);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", vpRunActivityPolish);
  } else {
    vpRunActivityPolish();
  }

  window.addEventListener("load", vpRunActivityPolish);

  const obs = new MutationObserver(() => vpRunActivityPolish());

  const startObserver = () => {
    if (document.body) {
      obs.observe(document.body, { childList: true, subtree: true });
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver);
  } else {
    startObserver();
  }
}


// VP_BOOKINGS_TAB_DOM_POLISH_V1
if (typeof window !== "undefined" && !window.__vpBookingsTabDomPolishV1) {
  window.__vpBookingsTabDomPolishV1 = true;

  const vpText = (el) => (el?.textContent || "").trim().replace(/\s+/g, " ");

  const vpFindBigPanel = (seed, checks = []) => {
    let current = seed;

    for (let i = 0; i < 10 && current; i += 1) {
      const text = vpText(current);
      const rect = current.getBoundingClientRect();

      if (
        rect.width > 360 &&
        rect.height > 220 &&
        checks.every((check) => text.includes(check))
      ) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  };

  const vpBookingIconSvg = (type) => {
    if (type === "photo") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="9" r="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m21 15-3.5-3.5a2 2 0 0 0-3 0L7 19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    if (type === "document") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 2v6h6M8 13h8M8 17h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    }

    if (type === "note") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
    }

    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v4M16 3v4M4 10h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="4" y="5" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  };

  const vpEnhanceSectionTitle = (titleEl, type, helper) => {
    if (!titleEl || titleEl.dataset.vpEnhanced === "1") return;

    titleEl.dataset.vpEnhanced = "1";
    titleEl.classList.add("vp-booking-media-title");
    titleEl.innerHTML = `
      <span class="vp-booking-title-icon">${vpBookingIconSvg(type)}</span>
      <span>${vpText(titleEl)}</span>
    `;

    if (helper) {
      const small = document.createElement("small");
      small.className = "vp-booking-section-helper";
      small.textContent = helper;
      titleEl.insertAdjacentElement("afterend", small);
    }
  };

  const vpApplyBookingsPolish = () => {
    const bookingHeading = Array.from(document.querySelectorAll("h1")).find((el) => {
      return vpText(el) === "Bookings";
    });

    if (!bookingHeading) {
      document.body.classList.remove("vp-bookings-polish-active");
      return;
    }

    // VP_EXACT_BOOKINGS_NATIVE_UI_BYPASS_V3
    // ExactBookingsPage follows the supplied reference directly. Do not run the
    // historic glow / neo-brutal / panel-detection DOM enhancer on this screen.
    if (document.querySelector('.exact-bookings-page')) {
      document.body.classList.remove("vp-bookings-polish-active");
      document.querySelector('.exact-bookings-page')?.classList.remove(
        'vp-booking-list-panel',
        'vp-booking-detail-panel',
        'vp-booking-row-card',
        'vp-booking-media-box'
      );
      return;
    }

    document.body.classList.add("vp-bookings-polish-active");

    const createBtn = Array.from(document.querySelectorAll("button, a")).find((el) => {
      return /Create Booking/i.test(vpText(el));
    });

    const exportBtn = Array.from(document.querySelectorAll("button, a")).find((el) => {
      return /Export CSV/i.test(vpText(el));
    });

    if (createBtn) {
      createBtn.classList.add("vp-booking-main-button");
    }

    if (exportBtn) {
      exportBtn.classList.add("vp-booking-soft-button");
    }

    const listPanel = createBtn ? vpFindBigPanel(createBtn, ["Bookings", "Search", "Status"]) : null;

    if (listPanel) {
      listPanel.classList.add("vp-booking-list-panel");
    }

    const bookingLabel = Array.from(document.querySelectorAll("*")).find((el) => {
      return vpText(el).toUpperCase() === "BOOKING";
    });

    const detailPanel = bookingLabel ? vpFindBigPanel(bookingLabel, ["Customer", "Phone", "Vehicle", "Registration"]) : null;

    if (detailPanel) {
      detailPanel.classList.add("vp-booking-detail-panel");
    }

    Array.from(document.querySelectorAll("input, select")).forEach((el) => {
      if (el.closest(".vp-booking-list-panel")) {
        el.classList.add("vp-booking-input");
      }
    });

    Array.from(document.querySelectorAll("*")).forEach((el) => {
      const text = vpText(el);

      if (/^\d+\s+bookings$/i.test(text)) {
        el.classList.add("vp-booking-count-pill");
      }

      if (/^(Pending|New|Quote Stage|In Progress|Completed|Closed)$/i.test(text)) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 160 && rect.height < 80) {
          el.classList.add("vp-booking-status-pill");
        }
      }
    });

    if (listPanel) {
      Array.from(listPanel.querySelectorAll("button, article, div")).forEach((el) => {
        const text = vpText(el);
        const rect = el.getBoundingClientRect();

        if (
          /JC-\d+/i.test(text) &&
          rect.width > 260 &&
          rect.height > 52 &&
          rect.height < 140
        ) {
          el.classList.add("vp-booking-row-card");
        }
      });
    }

    if (detailPanel) {
      Array.from(detailPanel.querySelectorAll("div, article, section")).forEach((el) => {
        const text = vpText(el);
        const rect = el.getBoundingClientRect();

        if (
          rect.width > 170 &&
          rect.height > 52 &&
          rect.height < 95 &&
          /Customer|Phone|Vehicle|Registration|Service|Location|Booking Date|Booking Time|Priority|Quote Amount|Fitter|Invoice/.test(text)
        ) {
          el.classList.add("vp-booking-info-tile");
        }
      });
    }

    const photosTitle = Array.from(document.querySelectorAll("*")).find((el) => vpText(el) === "Customer Photos");
    const docsTitle = Array.from(document.querySelectorAll("*")).find((el) => vpText(el) === "Customer Documents");
    const notesTitle = Array.from(document.querySelectorAll("*")).find((el) => vpText(el) === "Customer Notes");

    vpEnhanceSectionTitle(photosTitle, "photo", "Vehicle images and damage photos uploaded from WhatsApp will appear here.");
    vpEnhanceSectionTitle(docsTitle, "document", "PDFs, registration images and customer files are grouped here.");
    vpEnhanceSectionTitle(notesTitle, "note", "Internal notes and customer context for this booking.");

    [
      [photosTitle, "vp-booking-photos-section"],
      [docsTitle, "vp-booking-documents-section"],
      [notesTitle, "vp-booking-notes-section"]
    ].forEach(([title, className]) => {
      if (!title) return;

      let current = title.parentElement;

      for (let i = 0; i < 6 && current; i += 1) {
        const rect = current.getBoundingClientRect();

        if (rect.width > 120 && rect.height > 80) {
          current.classList.add(className);
          current.classList.add("vp-booking-media-box");
          break;
        }

        current = current.parentElement;
      }
    });

    Array.from(document.querySelectorAll("img")).forEach((img) => {
      if (img.closest(".vp-booking-detail-panel")) {
        img.classList.add("vp-booking-photo-img");
      }
    });

    Array.from(document.querySelectorAll("a, button, div")).forEach((el) => {
      const text = vpText(el);
      const rect = el.getBoundingClientRect();

      if (
        el.closest(".vp-booking-documents-section") &&
        /\.(pdf|jpg|jpeg|png|webp)$/i.test(text) &&
        rect.height > 24
      ) {
        el.classList.add("vp-booking-doc-row");
      }
    });

    Array.from(document.querySelectorAll("button, a")).forEach((el) => {
      const text = vpText(el);

      if (/Proceed|Add Note|View all|Download|Print|Send|Record Payment|Add Part|Create Booking|Export CSV/i.test(text)) {
        if (!el.closest("aside, nav, [role='navigation']")) {
          el.classList.add("vp-booking-action-button");
        }
      }
    });
  };

  const vpRunBookingsPolish = () => {
    requestAnimationFrame(() => {
      setTimeout(vpApplyBookingsPolish, 80);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", vpRunBookingsPolish);
  } else {
    vpRunBookingsPolish();
  }

  window.addEventListener("load", vpRunBookingsPolish);

  const obs = new MutationObserver(() => vpRunBookingsPolish());

  const startObserver = () => {
    if (document.body) {
      obs.observe(document.body, { childList: true, subtree: true });
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver);
  } else {
    startObserver();
  }
}


// VP_BOOKING_STATUS_NEO_BRUTALISM_CLASS_PATCH
if (typeof window !== "undefined" && !window.__vpBookingStatusNeoBrutalismPatch) {
  window.__vpBookingStatusNeoBrutalismPatch = true;

  const runStatusPatch = () => {
    if (!document.body.classList.contains("vp-bookings-polish-active")) return;

    Array.from(document.querySelectorAll("*")).forEach((el) => {
      const text = (el.textContent || "").trim().replace(/\s+/g, " ").toLowerCase();
      const rect = el.getBoundingClientRect();

      if (rect.width > 130 || rect.height > 80) return;

      el.classList.remove(
        "vp-status-quote-stage",
        "vp-status-in-progress",
        "vp-status-completed",
        "vp-status-closed"
      );

      if (text === "quote stage") el.classList.add("vp-status-quote-stage");
      if (text === "in progress") el.classList.add("vp-status-in-progress");
      if (text === "completed") el.classList.add("vp-status-completed");
      if (text === "closed") el.classList.add("vp-status-closed");
    });
  };

  const scheduleStatusPatch = () => {
    requestAnimationFrame(() => setTimeout(runStatusPatch, 80));
  };

  window.addEventListener("load", scheduleStatusPatch);
  document.addEventListener("click", scheduleStatusPatch);

  const obs = new MutationObserver(scheduleStatusPatch);

  const start = () => {
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    scheduleStatusPatch();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
}


// VP_CLAIMS_TAB_DOM_POLISH_V1
if (typeof window !== "undefined" && !window.__vpClaimsTabDomPolishV1) {
  window.__vpClaimsTabDomPolishV1 = true;

  const vpText = (el) => (el?.textContent || "").trim().replace(/\s+/g, " ");

  const vpFindPanel = (seed, checks = []) => {
    let current = seed;

    for (let i = 0; i < 10 && current; i += 1) {
      const text = vpText(current);
      const rect = current.getBoundingClientRect();

      if (
        rect.width > 300 &&
        rect.height > 180 &&
        checks.every((check) => text.includes(check))
      ) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  };

  const vpApplyClaimsPolish = () => {
    if (document.body.classList.contains('vp-claims-reference-native')) {
      document.body.classList.remove('vp-claims-polish-active');
      return;
    }
    const heading = Array.from(document.querySelectorAll("h1")).find((el) => {
      return vpText(el) === "Insurance Claims";
    });

    document.body.classList.toggle("vp-claims-polish-active", Boolean(heading));

    if (!heading) return;

    const exportBtn = Array.from(document.querySelectorAll("button, a")).find((el) => {
      return /Export CSV/i.test(vpText(el));
    });

    const claimsTitle = Array.from(document.querySelectorAll("*")).find((el) => {
      return vpText(el) === "Claims";
    });

    const emptyFound = Array.from(document.querySelectorAll("*")).find((el) => {
      return /No insurance claims found/i.test(vpText(el));
    });

    const listPanel = claimsTitle ? vpFindPanel(claimsTitle, ["Claims", "Search", "Status"]) : null;
    const detailPanel = emptyFound ? vpFindPanel(emptyFound, ["No insurance claims found"]) : null;

    if (listPanel) listPanel.classList.add("vp-claims-list-panel");
    if (detailPanel) detailPanel.classList.add("vp-claims-detail-panel");

    if (exportBtn) exportBtn.classList.add("vp-claims-action-button");

    Array.from(document.querySelectorAll("input, select")).forEach((el) => {
      if (el.closest(".vp-claims-list-panel")) {
        el.classList.add("vp-claims-input");
      }
    });

    Array.from(document.querySelectorAll("*")).forEach((el) => {
      const text = vpText(el);
      const rect = el.getBoundingClientRect();

      if (/^\d+\s+claims$/i.test(text)) {
        el.classList.add("vp-claims-count-pill");
      }

      if (
        /^(Pending|Approved|Submitted|Declined|In Review|Completed|Stable)$/i.test(text) &&
        rect.width < 150 &&
        rect.height < 80
      ) {
        el.classList.add("vp-claims-status-pill");
      }

      if (
        /No records yet|No insurance claims found|New records from the WhatsApp automation|Try changing the search/i.test(text)
      ) {
        let current = el.parentElement;

        for (let i = 0; i < 6 && current; i += 1) {
          const box = current.getBoundingClientRect();

          if (box.width > 240 && box.height > 70) {
            current.classList.add("vp-claims-empty-state");
            break;
          }

          current = current.parentElement;
        }
      }
    });

    if (listPanel) {
      Array.from(listPanel.querySelectorAll("button, article, div")).forEach((el) => {
        const text = vpText(el);
        const rect = el.getBoundingClientRect();

        if (
          /CL-|Claim|Customer|Vehicle/i.test(text) &&
          rect.width > 260 &&
          rect.height > 50 &&
          rect.height < 150
        ) {
          el.classList.add("vp-claims-row-card");
        }
      });
    }
  };

  const vpRunClaimsPolish = () => {
    requestAnimationFrame(() => {
      setTimeout(vpApplyClaimsPolish, 80);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", vpRunClaimsPolish);
  } else {
    vpRunClaimsPolish();
  }

  window.addEventListener("load", vpRunClaimsPolish);
  document.addEventListener("click", vpRunClaimsPolish);

  const obs = new MutationObserver(() => vpRunClaimsPolish());

  const startObserver = () => {
    if (document.body) {
      obs.observe(document.body, { childList: true, subtree: true });
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver);
  } else {
    startObserver();
  }
}


// VP_FORCE_CLAIMS_PAGE_POLISH_V2
if (typeof window !== "undefined" && !window.__vpForceClaimsPagePolishV2) {
  window.__vpForceClaimsPagePolishV2 = true;

  const cleanText = (el) => (el?.textContent || "").trim().replace(/\s+/g, " ");

  const addFonts = () => {
    if (document.getElementById("vp-font-polish-link")) return;

    const link = document.createElement("link");
    link.id = "vp-font-polish-link";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Manrope:wght@600;700;800&family=Sora:wght@600;700;800&display=swap";
    document.head.appendChild(link);
  };

  const findPanelFromText = (textNeedle, minW = 300, minH = 140) => {
    const node = Array.from(document.querySelectorAll("*")).find((el) => cleanText(el) === textNeedle);
    if (!node) return null;

    let current = node;

    for (let i = 0; i < 12 && current; i += 1) {
      const rect = current.getBoundingClientRect();

      if (rect.width > minW && rect.height > minH) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  };

  const findPanelContaining = (needle, minW = 300, minH = 140) => {
    const node = Array.from(document.querySelectorAll("*")).find((el) => cleanText(el).includes(needle));
    if (!node) return null;

    let current = node;

    for (let i = 0; i < 12 && current; i += 1) {
      const rect = current.getBoundingClientRect();

      if (rect.width > minW && rect.height > minH) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  };

  const applyClaimsPolish = () => {
    if (document.body.classList.contains('vp-claims-reference-native')) {
      document.body.classList.remove('vp-force-claims-active');
      return;
    }
    addFonts();

    const title = Array.from(document.querySelectorAll("h1")).find((el) => cleanText(el) === "Insurance Claims");
    const isClaims = Boolean(title);

    document.body.classList.toggle("vp-force-claims-active", isClaims);

    if (!isClaims) return;

    title.classList.add("vp-force-claims-title");

    if (title.nextElementSibling) {
      title.nextElementSibling.classList.add("vp-force-claims-subtitle");
    }

    const claimsListPanel = findPanelFromText("Claims", 360, 300);
    if (claimsListPanel) claimsListPanel.classList.add("vp-force-claims-panel", "vp-force-claims-list");

    const detailEmptyPanel = findPanelContaining("No insurance claims found", 360, 250);
    if (detailEmptyPanel) detailEmptyPanel.classList.add("vp-force-claims-panel", "vp-force-claims-detail");

    const noRecordsPanel = findPanelContaining("No records yet", 260, 120);
    if (noRecordsPanel) noRecordsPanel.classList.add("vp-force-claims-empty-box");

    const noClaimsPanel = findPanelContaining("No insurance claims found", 260, 120);
    if (noClaimsPanel) noClaimsPanel.classList.add("vp-force-claims-empty-box");

    Array.from(document.querySelectorAll("input, select")).forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 80 && rect.height > 25) {
        if (el.closest(".vp-force-claims-panel")) el.classList.add("vp-force-claims-control");
      }
    });

    Array.from(document.querySelectorAll("button, a")).forEach((el) => {
      const text = cleanText(el);

      if (/Export CSV|Open Claims|View all claims|Submit|Download|Print|Approve|Decline/i.test(text)) {
        if (!el.closest("aside, nav, [role='navigation']")) {
          el.classList.add("vp-force-claims-button");
        }
      }
    });

    Array.from(document.querySelectorAll("*")).forEach((el) => {
      const text = cleanText(el);
      const rect = el.getBoundingClientRect();

      if (/^\d+\s+claims$/i.test(text) && rect.width < 180) {
        el.classList.add("vp-force-claims-count");
      }

      if (/^(Pending|Stable|Approved|Submitted|Declined|In Review|Completed)$/i.test(text) && rect.width < 160 && rect.height < 90) {
        el.classList.add("vp-force-claims-status");
      }
    });
  };

  const run = () => requestAnimationFrame(() => setTimeout(applyClaimsPolish, 80));

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }

  window.addEventListener("load", run);
  document.addEventListener("click", run);

  setInterval(run, 700);

  const observer = new MutationObserver(run);
  const startObserver = () => {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver);
  } else {
    startObserver();
  }
}


// VP_CLAIMS_FINAL_FORCE_V3
if (typeof window !== "undefined" && !window.__vpClaimsFinalForceV3) {
  window.__vpClaimsFinalForceV3 = true;

  const txt = (el) => (el?.textContent || "").trim().replace(/\s+/g, " ");

  const addFontLink = () => {
    if (document.getElementById("vp-claims-fonts-v3")) return;

    const link = document.createElement("link");
    link.id = "vp-claims-fonts-v3";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Manrope:wght@600;700;800&family=Sora:wght@600;700;800&display=swap";
    document.head.appendChild(link);
  };

  const smallestPanel = (items) => {
    return items
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 360 && r.height > 220 && r.left > 250)
      .sort((a, b) => (a.r.width * a.r.height) - (b.r.width * b.r.height))[0]?.el || null;
  };

  const apply = () => {
    if (document.body.classList.contains('vp-claims-reference-native')) {
      document.body.classList.remove('vp-claims-final-page');
      return;
    }
    addFontLink();

    const title = Array.from(document.querySelectorAll("h1")).find((el) => txt(el) === "Insurance Claims");
    const isClaims = Boolean(title);

    document.body.classList.toggle("vp-claims-final-page", isClaims);

    if (!isClaims) return;

    title.classList.add("vp-claims-final-title");
    if (title.nextElementSibling) title.nextElementSibling.classList.add("vp-claims-final-subtitle");

    const all = Array.from(document.querySelectorAll("div, section, article, main"));

    const leftPanel = smallestPanel(all.filter((el) => {
      const t = txt(el);
      return t.includes("Claims") && t.includes("Search") && t.includes("Export CSV");
    }));

    const rightPanel = smallestPanel(all.filter((el) => {
      return txt(el).includes("No insurance claims found");
    }));

    if (leftPanel) leftPanel.classList.add("vp-claims-final-panel", "vp-claims-final-left");
    if (rightPanel) rightPanel.classList.add("vp-claims-final-panel", "vp-claims-final-right");

    document.querySelectorAll(".vp-claims-final-panel input, .vp-claims-final-panel select").forEach((el) => {
      el.classList.add("vp-claims-final-control");
    });

    document.querySelectorAll(".vp-claims-final-panel button, .vp-claims-final-panel a").forEach((el) => {
      const t = txt(el);

      if (/Export CSV|Open|Download|Submit|Approve|Decline|Print|Verify|Send|View/i.test(t)) {
        el.classList.add("vp-claims-final-button");
      }
    });

    all.forEach((el) => {
      const t = txt(el);
      const r = el.getBoundingClientRect();

      if (/^\d+\s+claims$/i.test(t) && r.width < 180 && r.height < 70) {
        el.classList.add("vp-claims-final-count");
      }

      if (
        /No records yet|No insurance claims found|New records from the WhatsApp automation|Try changing the search/i.test(t) &&
        r.width > 260 &&
        r.height > 80 &&
        r.left > 250
      ) {
        el.classList.add("vp-claims-final-empty");
      }

      if (
        /^(Pending|Stable|Approved|Submitted|Declined|In Review|Completed)$/i.test(t) &&
        r.width < 160 &&
        r.height < 80
      ) {
        el.classList.add("vp-claims-final-status");
      }
    });
  };

  const run = () => requestAnimationFrame(() => setTimeout(apply, 100));

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }

  window.addEventListener("load", run);
  window.addEventListener("resize", run);
  document.addEventListener("click", run);

  setInterval(run, 600);

  const observer = new MutationObserver(run);
  const start = () => {
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    run();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
}


// VP_JOBS_PAGE_POLISH_V1
if (typeof window !== "undefined" && !window.__vpJobsPagePolishV1) {
  window.__vpJobsPagePolishV1 = true;

  const clean = (el) => (el?.textContent || "").trim().replace(/\s+/g, " ");

  const findPanelFrom = (seed, checks = []) => {
    let cur = seed;

    for (let i = 0; i < 10 && cur; i += 1) {
      const text = clean(cur);
      const rect = cur.getBoundingClientRect();

      if (
        rect.width > 330 &&
        rect.height > 180 &&
        checks.every(x => text.includes(x))
      ) {
        return cur;
      }

      cur = cur.parentElement;
    }

    return null;
  };

  const applyJobsPolish = () => {
    if (document.body.classList.contains('vp-jobs-reference-native')) {
      document.body.classList.remove('vp-jobs-polish-active');
      return;
    }
    const title = Array.from(document.querySelectorAll("h1")).find(el => clean(el) === "Jobs");
    const active = Boolean(title);

    document.body.classList.toggle("vp-jobs-polish-active", active);

    if (!active) return;

    const createBtn = Array.from(document.querySelectorAll("button, a")).find(el => /Create Job/i.test(clean(el)));
    const exportBtn = Array.from(document.querySelectorAll("button, a")).find(el => /Export CSV/i.test(clean(el)));

    const listSeed = Array.from(document.querySelectorAll("*")).find(el => clean(el) === "Jobs");
    const jobSeed = Array.from(document.querySelectorAll("*")).find(el => clean(el).toUpperCase() === "JOB");

    const listPanel = createBtn ? findPanelFrom(createBtn, ["Jobs", "Search", "Status"]) : findPanelFrom(listSeed, ["Jobs", "Search", "Status"]);
    const detailPanel = jobSeed ? findPanelFrom(jobSeed, ["Customer", "Phone", "Vehicle", "Registration"]) : null;

    if (listPanel) listPanel.classList.add("vp-jobs-panel", "vp-jobs-list-panel");
    if (detailPanel) detailPanel.classList.add("vp-jobs-panel", "vp-jobs-detail-panel");

    if (createBtn) createBtn.classList.add("vp-jobs-primary-btn");
    if (exportBtn) exportBtn.classList.add("vp-jobs-soft-btn");

    Array.from(document.querySelectorAll("input, select")).forEach(el => {
      if (el.closest(".vp-jobs-panel")) el.classList.add("vp-jobs-control");
    });

    Array.from(document.querySelectorAll("*")).forEach(el => {
      const text = clean(el);
      const rect = el.getBoundingClientRect();

      if (/^\d+\s+jobs$/i.test(text) && rect.width < 180 && rect.height < 80) {
        el.classList.add("vp-jobs-count-pill");
      }

      if (
        /^(New|Pending|Quote Stage|In Progress|Completed|Closed|Waiting Parts|Active|Normal|Urgent|VIP)$/i.test(text) &&
        rect.width < 170 &&
        rect.height < 90
      ) {
        el.classList.add("vp-jobs-status-pill");

        el.classList.remove("vp-jobs-status-quote", "vp-jobs-status-progress", "vp-jobs-status-done", "vp-jobs-status-waiting");

        if (/quote stage/i.test(text)) el.classList.add("vp-jobs-status-quote");
        if (/in progress/i.test(text)) el.classList.add("vp-jobs-status-progress");
        if (/completed|closed/i.test(text)) el.classList.add("vp-jobs-status-done");
        if (/waiting parts/i.test(text)) el.classList.add("vp-jobs-status-waiting");
      }
    });

    if (listPanel) {
      Array.from(listPanel.querySelectorAll("button, article, div")).forEach(el => {
        const text = clean(el);
        const rect = el.getBoundingClientRect();

        if (
          /JC-\d+/i.test(text) &&
          rect.width > 260 &&
          rect.height > 50 &&
          rect.height < 150
        ) {
          el.classList.add("vp-jobs-row-card");
        }
      });
    }

    if (detailPanel) {
      Array.from(detailPanel.querySelectorAll("div, article, section")).forEach(el => {
        const text = clean(el);
        const rect = el.getBoundingClientRect();

        if (
          rect.width > 150 &&
          rect.height > 50 &&
          rect.height < 105 &&
          /Customer|Phone|Vehicle|Registration|Service|Location|Booking Date|Booking Time|Priority|Quote Amount|Fitter|Invoice/.test(text)
        ) {
          el.classList.add("vp-jobs-info-tile");
        }
      });

      Array.from(detailPanel.querySelectorAll("button, a")).forEach(el => {
        const text = clean(el);

        if (/Set Quote Amount|Assign Fitter|Convert to Job|Invoice Sent|Mark Paid|In Progress|Completed|Waiting Parts|Closed|Print|Send|Add Internal Note|Record Payment|Add Part/i.test(text)) {
          el.classList.add("vp-jobs-action-btn");
        }
      });
    }
  };

  const run = () => requestAnimationFrame(() => setTimeout(applyJobsPolish, 80));

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }

  window.addEventListener("load", run);
  window.addEventListener("resize", run);
  document.addEventListener("click", run);

  const obs = new MutationObserver(run);
  const start = () => {
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    run();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
}


// VP_LIGHT_THEME_ONLY_V1
if (typeof window !== "undefined" && !window.__vpLightThemeOnlyV1) {
  window.__vpLightThemeOnlyV1 = true;

  const text = (el) => (el?.textContent || "").trim().replace(/\s+/g, " ");

  function forceLightTheme() {
    try {
      localStorage.setItem("theme", "light");
      localStorage.setItem("studio-theme", "light");
      localStorage.setItem("dashboard-theme", "light");
      localStorage.setItem("appearance", "light");
      localStorage.removeItem("dark");
      localStorage.removeItem("darkMode");
    } catch {}

    document.documentElement.classList.remove("dark", "dark-theme", "theme-dark");
    document.body.classList.remove("dark", "dark-theme", "theme-dark");

    document.documentElement.classList.add("light", "theme-light");
    document.body.classList.add("light", "theme-light", "vp-light-only");

    document.documentElement.setAttribute("data-theme", "light");
    document.body.setAttribute("data-theme", "light");
  }

  function hideThemeOptions() {
    forceLightTheme();

    const settingsTitle = Array.from(document.querySelectorAll("h1,h2,h3")).find((el) => {
      return text(el).toLowerCase() === "settings";
    });

    document.body.classList.toggle("vp-settings-page-open", Boolean(settingsTitle));

    if (!settingsTitle) return;

    const candidates = Array.from(document.querySelectorAll("main label, main button, main div, main section, main article"))
      .filter((el) => {
        const t = text(el).toLowerCase();
        const r = el.getBoundingClientRect();

        if (!t) return false;
        if (r.width < 80 || r.height < 18) return false;
        if (r.height > 180) return false;

        return (
          t === "dark mode" ||
          t === "dark theme" ||
          t === "theme" ||
          t === "appearance" ||
          t.includes("dark mode") ||
          t.includes("dark theme") ||
          t.includes("switch theme") ||
          t.includes("change theme") ||
          t.includes("appearance mode")
        );
      });

    candidates.forEach((el) => {
      let target = el;

      for (let i = 0; i < 5 && target?.parentElement; i += 1) {
        const r = target.parentElement.getBoundingClientRect();
        const parentText = text(target.parentElement).toLowerCase();

        if (
          r.height <= 180 &&
          r.width >= 180 &&
          (
            parentText.includes("dark") ||
            parentText.includes("theme") ||
            parentText.includes("appearance")
          )
        ) {
          target = target.parentElement;
        }
      }

      target.classList.add("vp-hide-theme-option");
      target.setAttribute("aria-hidden", "true");
    });

    Array.from(document.querySelectorAll("input[type='checkbox'], input[type='radio'], select")).forEach((el) => {
      const parentText = text(el.closest("label, div, section, article") || el.parentElement).toLowerCase();

      if (parentText.includes("dark") || parentText.includes("theme") || parentText.includes("appearance")) {
        const row = el.closest("label, div, section, article") || el;
        row.classList.add("vp-hide-theme-option");
        row.setAttribute("aria-hidden", "true");
      }
    });
  }

  forceLightTheme();

  const run = () => requestAnimationFrame(() => setTimeout(hideThemeOptions, 80));

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }

  window.addEventListener("load", run);
  window.addEventListener("resize", run);
  document.addEventListener("click", run);

  const observer = new MutationObserver(run);

  const start = () => {
    if (document.body) observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-theme"]
    });
    run();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
}

// VP_MOBILE_NAV_CLEAN_FINAL_V1
setTimeout(() => {
  try {
    const isMobile = () => window.innerWidth <= 900;

    const items = [
      { label: 'Dashboard', icon: '▦' },
      { label: 'Activity', icon: '◷' },
      { label: 'Bookings', icon: '▣' },
      { label: 'Insurance Claims', icon: '▤' },
      { label: 'Jobs', icon: '▥' },
      { label: 'Customers', icon: '◉' },
      { label: 'WiFi Vouchers', icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 8.8a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.2a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/></svg>' },
      { label: 'Settings', icon: '⚙' }
    ];

    function closeDrawer() {
      document.body.classList.remove('vp-mobile-nav-open');
    }

    function openDrawer() {
      document.body.classList.add('vp-mobile-nav-open');
    }

    function getText(el) {
      return (el?.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    function findOriginalSidebar() {
      const candidates = Array.from(document.querySelectorAll('aside, nav, .desktop-sidebar, [class*="sidebar"], [class*="Sidebar"]'));

      return candidates.find(el => {
        if (el.closest('.vp-clean-mobile-drawer')) return false;

        const text = getText(el);

        return text.includes('dashboard') &&
          text.includes('activity') &&
          text.includes('bookings') &&
          text.includes('insurance claims') &&
          text.includes('jobs') &&
          text.includes('customers') &&
          text.includes('settings');
      }) || null;
    }

    function findLogoSrc() {
      const img = Array.from(document.querySelectorAll('img')).find(image => {
        const src = image.src || '';
        const alt = (image.alt || '').toLowerCase();
        return src.includes('logo') || src.includes('windscreen') || alt.includes('logo') || alt.includes('windscreen');
      });

      return img ? img.src : '';
    }

    function clickOriginalTab(label) {
      const target = label.toLowerCase();

      const button = Array.from(document.querySelectorAll('button, a, [role="button"]')).find(el => {
        if (el.closest('.vp-clean-mobile-drawer')) return false;
        return getText(el).includes(target);
      });

      if (button) {
        button.click();
        return true;
      }

      return false;
    }

    function activeLabel() {
      const active = Array.from(document.querySelectorAll('button.active, [aria-current="page"], .active')).find(el => {
        if (el.closest('.vp-clean-mobile-drawer')) return false;
        const text = getText(el);
        return items.some(item => text.includes(item.label.toLowerCase()));
      });

      return active ? items.find(item => getText(active).includes(item.label.toLowerCase()))?.label : 'Dashboard';
    }

    function buildDrawer() {
      if (document.querySelector('.vp-clean-mobile-drawer')) return;

      const logo = findLogoSrc();

      const backdrop = document.createElement('div');
      backdrop.className = 'vp-clean-mobile-backdrop';
      backdrop.addEventListener('click', closeDrawer);

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'vp-clean-mobile-trigger';
      trigger.setAttribute('aria-label', 'Open menu');
      trigger.innerHTML = '<span></span>';
      trigger.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();

        if (document.body.classList.contains('vp-mobile-nav-open')) {
          closeDrawer();
        } else {
          openDrawer();
        }
      });

      const drawer = document.createElement('div');
      drawer.className = 'vp-clean-mobile-drawer';

      const head = document.createElement('div');
      head.className = 'vp-clean-mobile-drawer-head';
      head.innerHTML = `
        <div class="vp-clean-mobile-brand">
          ${logo ? `<img src="${logo}" alt="Windscreen logo">` : ''}
          <div>
            <strong>Windscreen</strong>
            <small>Automation Dashboard</small>
          </div>
        </div>
      `;

      const nav = document.createElement('div');
      nav.className = 'vp-clean-mobile-nav';

      items.forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.label = item.label;
        btn.innerHTML = `
          <span class="vp-clean-mobile-nav-icon">${item.icon}</span>
          <span>${item.label}</span>
        `;

        btn.addEventListener('click', () => {
          clickOriginalTab(item.label);
          closeDrawer();
          setTimeout(syncActive, 150);
        });

        nav.appendChild(btn);
      });

      drawer.appendChild(head);
      drawer.appendChild(nav);

      document.body.appendChild(backdrop);
      document.body.appendChild(drawer);
      document.body.appendChild(trigger);
    }

    function syncActive() {
      const current = activeLabel();

      document.querySelectorAll('.vp-clean-mobile-nav button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.label === current);
      });
    }

    function hideOriginalSidebar() {
      const original = findOriginalSidebar();

      if (original && isMobile()) {
        original.classList.add('vp-original-sidebar-hidden-mobile');
      }

      if (original && !isMobile()) {
        original.classList.remove('vp-original-sidebar-hidden-mobile');
      }
    }

    function setup() {
      buildDrawer();
      hideOriginalSidebar();
      syncActive();

      if (!isMobile()) {
        closeDrawer();
      }
    }

    setup();
    window.addEventListener('resize', setup);
    setInterval(setup, 1200);
  } catch (error) {
    console.error('VP_MOBILE_NAV_CLEAN_FINAL_ERROR', error);
  }
}, 900);

// VP_SAFE_CLAIM_JOB_UI_V2
setTimeout(() => {
  try {
    const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();

    const actionLabels = {
      approve: ['approved', 'send approval'],
      review: ['needs review'],
      reject: ['rejected'],
      pos: ['submit to pos'],
      print: ['print claim summary'],
      pdf: ['open claim pdf'],
      note: ['add internal note']
    };

    function text(el) {
      return norm(el?.textContent || el?.innerText || el?.value || el?.getAttribute?.('aria-label'));
    }

    function visible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 2 && r.height > 2 && st.display !== 'none' && st.visibility !== 'hidden';
    }

    function matchAny(el, arr) {
      const t = text(el);
      return arr.some(x => t.includes(norm(x)));
    }

    function allButtons(root = document) {
      return Array.from(root.querySelectorAll('button, a, [role="button"]')).filter(visible);
    }

    function findBtn(root, arr) {
      return allButtons(root).find(btn => matchAny(btn, arr)) || null;
    }

    function clickBtn(btn) {
      if (!btn) return false;
      btn.click();
      return true;
    }

    function findActionRows() {
      const targets = allButtons(document).filter(btn =>
        matchAny(btn, actionLabels.approve) ||
        matchAny(btn, actionLabels.review) ||
        matchAny(btn, actionLabels.reject) ||
        matchAny(btn, actionLabels.pos) ||
        matchAny(btn, actionLabels.print) ||
        matchAny(btn, actionLabels.pdf)
      );

      const rows = new Set();

      for (const btn of targets) {
        let el = btn.parentElement;

        for (let depth = 0; el && depth < 5; depth++, el = el.parentElement) {
          if (!visible(el)) continue;
          if (el.classList.contains('vp-control-panel-card')) break;

          const r = el.getBoundingClientRect();
          const buttons = allButtons(el);
          const joined = buttons.map(text).join(' | ');

          const hasWorkflow =
            joined.includes('approved') &&
            joined.includes('needs review') &&
            joined.includes('rejected');

          const hasTools =
            joined.includes('open claim pdf') ||
            joined.includes('print claim summary') ||
            joined.includes('submit to pos');

          const correctSize =
            r.height > 28 &&
            r.height < 170 &&
            r.width > 220 &&
            buttons.length >= 2 &&
            buttons.length <= 12;

          if ((hasWorkflow || hasTools) && correctSize) {
            rows.add(el);
            break;
          }
        }
      }

      return Array.from(rows);
    }

    function buildPanel(row) {
      if (!row || row.dataset.vpSafeUiDone === '1') return;
      if (row.previousElementSibling?.classList?.contains('vp-control-panel-card')) {
        row.dataset.vpSafeUiDone = '1';
        return;
      }

      const original = {
        approve: findBtn(row, actionLabels.approve),
        review: findBtn(row, actionLabels.review),
        reject: findBtn(row, actionLabels.reject),
        pos: findBtn(row, actionLabels.pos),
        print: findBtn(row, actionLabels.print),
        pdf: findBtn(row, actionLabels.pdf),
        note: findBtn(row, actionLabels.note)
      };

      const panel = document.createElement('div');
      panel.className = 'vp-control-panel-card';

      const workflow = document.createElement('div');
      workflow.className = 'vp-panel-section';
      workflow.innerHTML = [
        '<h4>Customer Workflow Matrix</h4>',
        '<div class="vp-action-dropdown">',
        '<button type="button" class="vp-action-toggle">',
        '<span class="vp-current-action-text">Send Approval to Customer</span>',
        '<span>▼</span>',
        '</button>',
        '<ul class="vp-action-menu">',
        '<li data-action="approve">Send Approval to Customer</li>',
        '<li data-action="review">Send "Needs Review" to Customer</li>',
        '<li data-action="reject" class="danger">Send "Rejected" to Customer</li>',
        '</ul>',
        '</div>'
      ].join('');

      const tools = document.createElement('div');
      tools.className = 'vp-panel-section';
      tools.innerHTML = '<h4>Documents</h4>';

      const toolWrap = document.createElement('div');
      toolWrap.className = 'vp-panel-tools';

      if (original.print) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Print Claim Summary';
        b.onclick = () => clickBtn(original.print);
        toolWrap.appendChild(b);
      }

      if (original.pdf) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Open Claim PDF';
        b.onclick = () => clickBtn(original.pdf);
        toolWrap.appendChild(b);
      }

      if (original.pos) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Submit to POS';
        b.onclick = () => clickBtn(original.pos);
        toolWrap.appendChild(b);
      }

      if (original.note) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Add Internal Note';
        b.onclick = () => clickBtn(original.note);
        toolWrap.appendChild(b);
      }

      tools.appendChild(toolWrap);

      panel.appendChild(workflow);
      panel.appendChild(tools);

      row.parentElement.insertBefore(panel, row);

      const dropdown = workflow.querySelector('.vp-action-dropdown');
      const toggle = workflow.querySelector('.vp-action-toggle');
      const current = workflow.querySelector('.vp-current-action-text');

      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        document.querySelectorAll('.vp-action-dropdown.open').forEach(x => {
          if (x !== dropdown) x.classList.remove('open');
        });

        dropdown.classList.toggle('open');
      });

      workflow.querySelectorAll('.vp-action-menu li').forEach(item => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          const action = item.dataset.action;
          current.textContent = item.textContent.trim();
          dropdown.classList.remove('open');

          if (action === 'approve') clickBtn(original.approve);
          if (action === 'review') clickBtn(original.review);
          if (action === 'reject') clickBtn(original.reject);
        });
      });

      const hideKeys = ['approve', 'review', 'reject', 'pos', 'print', 'pdf', 'note'];
      hideKeys.forEach(k => {
        if (original[k]) original[k].classList.add('vp-old-action-hidden');
      });

      row.dataset.vpSafeUiDone = '1';
    }

    function cleanStatuses() {
      // VP_STATUS_POLISH_SAFE_SCOPE_V2
      // Status decoration must never touch page/layout containers. The old
      // implementation scanned every div and could turn an entire dashboard
      // into a 999px pill when descendant text contained a status phrase.
      Array.from(document.querySelectorAll('span, small, b, strong, em')).forEach(el => {
        if (!visible(el)) return;
        if (el.closest('.vp-sidebar, .vp-topbar, .vp-dashboard-intro')) return;

        const r = el.getBoundingClientRect();
        if (r.width > 320 || r.height > 90) return;

        const t = text(el);

        if (t === 'submitted_for_processing' || t === 'submitted for processing') {
          el.textContent = 'Submitted for processing';
          el.classList.add('vp-status-blue');
        }

        if (t === 'waiting for customer to confirm') {
          el.textContent = 'Awaiting customer verification and confirmation to proceed.';
          el.classList.add('vp-status-waiting');
        }
      });
    }

    function removeInternalNotes() {
      Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,b,strong')).forEach(head => {
        if (text(head) !== 'internal notes') return;

        let block = head.parentElement;
        for (let i = 0; block && i < 4; i++, block = block.parentElement) {
          const r = block.getBoundingClientRect();
          const t = text(block);

          if (
            r.height > 40 &&
            r.height < 500 &&
            t.includes('internal notes') &&
            (t.includes('media') || t.includes('whatsapp image uploaded') || t.includes('bot'))
          ) {
            block.classList.add('vp-internal-notes-hidden');
            return;
          }
        }

        head.classList.add('vp-internal-notes-hidden');
      });
    }

    function topRightActions() {
      const buttons = allButtons(document)
        .filter(btn => {
          if (btn.closest('.job-month-control')) return false;
          const r = btn.getBoundingClientRect();
          return r.top >= 0 && r.top < 105 && r.right > window.innerWidth - 260 && r.width >= 28 && r.height >= 28;
        })
        .slice(-4);

      buttons.forEach((btn, idx) => {
        btn.classList.add('vp-top-action-btn');

        if (btn.dataset.vpTopBound === '1') return;
        btn.dataset.vpTopBound = '1';

        btn.addEventListener('click', (e) => {
          const label = text(btn);

          const isSearch = label.includes('search') || idx === 0;
          const isBell = label.includes('bell') || label.includes('notification') || idx === 1;

          if (isSearch) {
            const input = document.querySelector('input[type="search"], input[placeholder*="Search"], input[placeholder*="search"]');
            if (input) {
              input.focus();
              return;
            }
          }

          e.stopPropagation();
          document.querySelectorAll('.vp-top-popover').forEach(x => x.remove());

          const pop = document.createElement('div');
          pop.className = 'vp-top-popover';

          if (isBell) {
            pop.innerHTML = 'Notifications<small>No new notifications.</small>';
          } else {
            pop.innerHTML = 'My Account<small>Dashboard admin session is active.</small>';
          }

          document.body.appendChild(pop);
        });
      });
    }

    function run() {
      const claimsPage = document.body.classList.contains('vp-claims-reference-native');

      if (claimsPage) {
        document.querySelectorAll('.vp-control-panel-card').forEach(panel => panel.remove());
        document.querySelectorAll('.vp-old-action-hidden').forEach(el => el.classList.remove('vp-old-action-hidden'));
      } else {
        document.querySelectorAll('.vp-control-panel-card').forEach(panel => {
          const next = panel.nextElementSibling;
          if (!next || next.dataset.vpSafeUiDone !== '1') panel.remove();
        });
        findActionRows().forEach(buildPanel);
      }

      cleanStatuses();
      removeInternalNotes();
      topRightActions();
    }

    run();
    setInterval(run, 1500);

    document.addEventListener('click', () => {
      document.querySelectorAll('.vp-action-dropdown.open').forEach(x => x.classList.remove('open'));
      document.querySelectorAll('.vp-top-popover').forEach(x => x.remove());
    });
  } catch (e) {
    console.error('VP_SAFE_CLAIM_JOB_UI_V2_ERROR', e);
  }
}, 900);
