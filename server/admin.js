import {
  SYLLABUS_TRACKS,
  VIOLATION_LABELS,
  TEST_COUPON_CODE,
  isTestCoupon,
  isTestCouponEnabled,
  sharedSupportTickets,
  sharedDevicePolicyState
} from './logic.js';
import {
  deleteCouponByCode,
  fetchTestCouponsForAdmin,
  formatTestCouponMeta,
  isTestTransactionRecord,
  resolveCouponByCode,
  setCouponStatusInStore
} from './test-coupon.js';
import { batchTools, bustBatchCache } from './batches.js';
import { buildCertificatePDF, certificateNumber, verifyCertificateEligibility } from './certificate.js';
import { buildReceiptPDF } from './receipt.js';

// Fallback in-memory stores for offline testing / fast dev
const localAuditLogs = [];
const localMentors = [
  { id: 'm1', name: 'Dr. K. Ravindran', email: 'ravindran.k@plantgreeninertia.com', phone: '+91 94440 12345', domain: 'Full-Stack Web Development & Cloud Architecture', title: 'Lead Academic Architect & Principal Mentor', bio: '18+ years in distributed systems, full-stack enterprise architecture, and student mentorship.', active: true },
  { id: 'm2', name: 'Prof. Meenakshi Sundaram', email: 'meenakshi.s@plantgreeninertia.com', phone: '+91 94440 23456', domain: 'Android & Mobile Development', title: 'Mobile Systems Specialist', bio: 'Specializing in Android OS internals, MIT App Inventor, and edge mobile computing.', active: true },
  { id: 'm3', name: 'Arunachalam S.', email: 'arunachalam.s@plantgreeninertia.com', phone: '+91 94440 34567', domain: 'Digital Marketing & Growth', title: 'Head of Growth Engineering', bio: 'Digital marketing director with expertise in SEO, analytics funnels, and enterprise acquisition.', active: true },
  { id: 'm4', name: 'Divya Bharathi', email: 'divya.b@plantgreeninertia.com', phone: '+91 94440 45678', domain: 'Business Analytics & Data', title: 'Senior Data Strategist', bio: 'Analytics consultant focused on PowerBI, SQL warehousing, and predictive market modeling.', active: true }
];
const localCertificates = new Map();
const localNotifications = [
  { id: 'n1', title: 'Winter Cohort 2026 Orientation', message: 'Welcome to Plant Green Inertia Winter Internship! Orientation begins promptly at your scheduled time. Review your 30-hour curriculum syllabus.', target_track: 'all', target_mode: 'all', priority: 'high', created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: 'n2', title: 'Daily Attendance Verification Notice', message: 'Attendance must be verified for all 10 sessions (3 hours/day) to qualify for your official completion certificate and 1-page project report.', target_track: 'all', target_mode: 'all', priority: 'normal', created_at: new Date(Date.now() - 7200000).toISOString() }
];

export function mountAdmin({ app, db, auth, wrap, fail, reportData, sendPdf, buildReportPDF, reportId }) {
  // Admin Authorization Gate (requires authenticated user with profiles.role = 'admin')
  const adminOnly = async (req, _res, next) => {
    try {
      const { data } = await db.from('profiles').select('role').eq('id', req.user.id).single();
      if (data?.role === 'admin') return next();
      next(fail(403, 'Access denied: Administrator privileges required.'));
    } catch (e) {
      next(e);
    }
  };

  const A = (m, p, f) => app[m]('/api/admin' + p, auth, adminOnly, wrap(f));
  const rows = async q => { const { data, error } = await q; if (error) throw fail(500, error.message); return data || []; };

  // Helper to log all administrative actions
  async function logAudit(req, action, targetType, targetId, details = {}) {
    const logEntry = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2),
      admin_id: req.user?.id || null,
      admin_email: req.user?.email || 'admin@plantgreeninertia.com',
      action,
      target_type: targetType,
      target_id: String(targetId || ''),
      details,
      ip_address: req.ip || req.headers?.['x-forwarded-for'] || '127.0.0.1',
      created_at: new Date().toISOString()
    };

    try {
      await db.from('admin_audit_logs').insert(logEntry);
    } catch {}
    localAuditLogs.unshift(logEntry);
    if (localAuditLogs.length > 500) localAuditLogs.pop();
    return logEntry;
  }

  const people = async () => {
    const ps = await rows(db.from('profiles').select('id,full_name,phone,role,created_at,student_id').order('created_at', { ascending: false }).limit(5000));
    let em = {};
    let metaById = {};
    try {
      const { data: u } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      em = Object.fromEntries((u?.users || []).map(x => [x.id, x.email]));
      metaById = Object.fromEntries((u?.users || []).map(x => [x.id, x.user_metadata || {}]));
    } catch {}
    return { ps, em, metaById, by: Object.fromEntries(ps.map(p => [p.id, p])) };
  };

  async function resolveDesktopOnlyFlag(settingsRow) {
    if (typeof sharedDevicePolicyState.desktopOnlyOverride === 'boolean') {
      return sharedDevicePolicyState.desktopOnlyOverride;
    }
    if (settingsRow && typeof settingsRow.desktop_only === 'boolean') {
      return settingsRow.desktop_only;
    }
    try {
      const { data } = await db.from('admin_audit_logs')
        .select('details')
        .eq('action', 'UPDATE_TEST_SETTINGS')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.details && typeof data.details.desktop_only === 'boolean') {
        sharedDevicePolicyState.desktopOnlyOverride = data.details.desktop_only;
        return data.details.desktop_only;
      }
    } catch {}
    return true;
  }

  async function fetchBlockedDeviceLogs() {
    let dbLogs = [];
    try {
      const { data } = await db.from('admin_audit_logs')
        .select('*')
        .eq('action', 'ASSESSMENT_DEVICE_BLOCKED')
        .order('created_at', { ascending: false })
        .limit(500);
      if (Array.isArray(data)) dbLogs = data;
    } catch {}
    const seen = new Set();
    const combined = [];
    for (const row of [...sharedDevicePolicyState.blockedEvents, ...localAuditLogs, ...dbLogs]) {
      if (!row || row.action !== 'ASSESSMENT_DEVICE_BLOCKED') continue;
      const key = row.id || `${row.target_id}|${row.created_at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(row);
    }
    combined.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    return combined;
  }

  const { resolveBatch } = batchTools(db, fail);
  const scope = q => resolveBatch(q.query?.batch);
  const S = (B, q) => B ? q.eq('batch_id', B.id) : q;

  // ===================================================================
  // 1. ANALYTICS (Real data breakdown)
  // ===================================================================
  async function getFullAnalytics(B) {
    const [
      apps, attempts, rawPaidOrders, rawCreatedOrders, rawFailedOrders,
      rawCoupons, rawEnrollments, settings, blockedLogs
    ] = await Promise.all([
      rows(db.from('internship_applications').select('*').limit(50000)),
      rows(S(B, db.from('assessment_attempts').select('*')).limit(50000)),
      rows(S(B, db.from('payment_orders').select('*')).eq('status', 'paid').not('razorpay_payment_id', 'is', null).limit(50000)),
      rows(S(B, db.from('payment_orders').select('*')).eq('status', 'created').limit(50000)),
      rows(S(B, db.from('payment_orders').select('*')).in('status', ['cancelled', 'needs_refund', 'failed']).limit(50000)),
      rows(S(B, db.from('scholarship_coupons').select('*')).limit(50000)),
      rows(S(B, db.from('enrollments').select('*')).limit(50000)),
      db.from('test_settings').select('*').eq('id', 1).maybeSingle().then(r => r.data || { pass_mark: 30 }),
      fetchBlockedDeviceLogs().catch(() => [])
    ]);

    // Filter out test coupon transactions and test enrollments from revenue, payment reports, and metrics
    const paidOrders = rawPaidOrders.filter(o => !isTestTransactionRecord(o));
    const createdOrders = rawCreatedOrders.filter(o => !isTestTransactionRecord(o));
    const failedOrders = rawFailedOrders.filter(o => !isTestTransactionRecord(o));
    const coupons = rawCoupons.filter(c => !isTestCoupon(c));
    const enrollments = rawEnrollments.filter(e => !isTestTransactionRecord(e));

    const passMark = settings.pass_mark || 30;

    // Applications & Mode Breakdown
    const totalApps = apps.length;
    const onlineApps = apps.filter(a => String(a.mode || '').toLowerCase().includes('online')).length;
    const offlineApps = apps.filter(a => String(a.mode || '').toLowerCase().includes('offline')).length;

    // Referral link & Domain track breakdowns
    const referralMap = {};
    const domainMap = {};
    apps.forEach(a => {
      const ref = a.referral_code ? a.referral_code.trim().toLowerCase() : 'direct';
      referralMap[ref] = (referralMap[ref] || 0) + 1;
      const dom = String(a.domain_name || 'Unassigned').trim();
      if (!domainMap[dom]) domainMap[dom] = { domain: dom, domainType: a.domain_type || 'Technical', count: 0 };
      domainMap[dom].count += 1;
    });
    const referralBreakdown = Object.entries(referralMap)
      .map(([code, count]) => ({ code, count, percentage: totalApps ? Math.round((count / totalApps) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);
    const domainBreakdown = Object.values(domainMap)
      .map(d => ({ ...d, percentage: totalApps ? Math.round((d.count / totalApps) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);

    // Assessments & Eligibility
    const submittedAttempts = attempts.filter(a => a.status !== 'in_progress');
    const eligibleCount = submittedAttempts.filter(a => Number(a.score_percent || 0) >= passMark).length;
    const inProgressAttempts = attempts.filter(a => a.status === 'in_progress').length;

    // Payments
    const revenuePaise = paidOrders.reduce((sum, o) => sum + Number(o.amount_paise || 0), 0);
    const completedPaymentsCount = paidOrders.length;
    const pendingPaymentsCount = createdOrders.length;
    const failedPaymentsCount = failedOrders.length;

    // Interns
    const activeInterns = enrollments.filter(e => e.status === 'active').length;
    const totalEnrollments = enrollments.length;

    // Coupons
    const now = new Date();
    const couponsIssued = coupons.length;
    const couponsUsed = coupons.filter(c => c.status === 'redeemed').length;
    const couponsExpired = coupons.filter(c => c.status !== 'redeemed' && new Date(c.expires_at) < now).length;
    const couponsActive = coupons.filter(c => c.status === 'active' && new Date(c.expires_at) >= now).length;

    const desktopOnly = await resolveDesktopOnlyFlag(settings);

    return {
      applications: {
        total: totalApps,
        online: onlineApps,
        offline: offlineApps,
        referrals: referralBreakdown,
        domains: domainBreakdown
      },
      assessments: {
        totalStarted: attempts.length,
        completed: submittedAttempts.length,
        inProgress: inProgressAttempts,
        eligible: eligibleCount,
        passMark,
        passRate: submittedAttempts.length ? Math.round((eligibleCount / submittedAttempts.length) * 100) : 0,
        desktopOnly,
        blockedDeviceCount: blockedLogs.length,
        recentBlockedDevices: blockedLogs.slice(0, 15).map(b => ({
          id: b.id,
          applicationId: b.details?.application_id || b.target_id || 'UNKNOWN',
          email: b.details?.email || b.admin_email || '',
          time: b.details?.time || b.created_at,
          userAgent: b.details?.user_agent || '',
          reason: b.details?.reason || 'device_not_allowed',
          endpoint: b.details?.endpoint || ''
        }))
      },
      payments: {
        completedCount: completedPaymentsCount,
        pendingCount: pendingPaymentsCount,
        failedCount: failedPaymentsCount,
        revenuePaise,
        revenueRupees: revenuePaise / 100
      },
      interns: {
        active: activeInterns,
        totalEnrolled: totalEnrollments,
        online: enrollments.filter(e => String(e.mode || '').toLowerCase().includes('online') || !e.mode).length,
        offline: enrollments.filter(e => String(e.mode || '').toLowerCase().includes('offline')).length,
        completed: enrollments.filter(e => e.status === 'completed').length
      },
      coupons: {
        issued: couponsIssued,
        used: couponsUsed,
        expired: couponsExpired,
        active: couponsActive
      }
    };
  }

  A('get', '/analytics', async (req, res) => {
    res.json(await getFullAnalytics(await scope(req)));
  });

  A('get', '/overview', async (req, res) => {
    const a = await getFullAnalytics(await scope(req));
    // Backwards-compatible structure for existing tiles
    res.json({
      students: a.applications.total,
      attempts: a.assessments.totalStarted,
      submitted: a.assessments.completed,
      running: a.assessments.inProgress,
      eligible: a.assessments.eligible,
      coupons: a.coupons.issued,
      redeemed: a.coupons.used,
      enrolled: a.interns.active,
      enrollTotal: a.interns.totalEnrolled,
      paidOrders: a.payments.completedCount,
      revenuePaise: a.payments.revenuePaise,
      pending: a.payments.pendingCount,
      failed: a.payments.failedCount,
      blockedDeviceCount: a.assessments.blockedDeviceCount,
      desktopOnly: a.assessments.desktopOnly,
      applications: a.applications,
      referrals: a.applications.referrals
    });
  });

  // ===================================================================
  // 2. STUDENTS (Search, Filter, Full Dossier, Assignment & Status Update)
  // ===================================================================
  A('get', '/students', async (req, res) => {
    const { ps, em, metaById, by } = await people();
    const [apps, attempts, coupons, enrollments, attLogs, batches, mentors] = await Promise.all([
      rows(db.from('internship_applications').select('*').order('created_at', { ascending: false }).limit(5000)),
      rows(db.from('assessment_attempts').select('id,user_id,status,score_percent,started_at,correct_count,total_questions').order('started_at', { ascending: false })),
      rows(db.from('scholarship_coupons').select('user_id,code,discount_percent,expires_at,status')),
      rows(db.from('enrollments').select('user_id,status,kind,amount_paise,transaction_ref,enrolled_at,receipt_no,student_id')),
      rows(db.from('student_attendance').select('student_id,user_id,status,hours_logged')),
      rows(db.from('batches').select('id,name')),
      rows(db.from('mentors').select('id,name,domain'))
    ]);

    const batchMap = Object.fromEntries(batches.map(b => [b.id, b.name]));
    const mentorMap = Object.fromEntries(mentors.map(m => [m.id, m.name]));

    // Index attendance by student_id and user_id
    const attMap = {};
    attLogs.forEach(r => {
      const k = r.student_id || r.user_id;
      if (!k) return;
      if (!attMap[k]) attMap[k] = { present: 0, absent: 0, hours: 0 };
      if (r.status === 'present') {
        attMap[k].present += 1;
        attMap[k].hours += Number(r.hours_logged || 0);
      } else if (r.status === 'absent') {
        attMap[k].absent += 1;
      }
    });

    const first = (arr, id, email) => arr.find(x => x.user_id === id || (email && x.email?.toLowerCase() === email.toLowerCase()));

    // Combine applications and profiles
    const studentDossiers = [];
    const seenEmails = new Set();

    // From applications table
    apps.forEach(appRec => {
      const email = appRec.email?.toLowerCase();
      if (!email || seenEmails.has(email)) return;
      seenEmails.add(email);

      const prof = ps.find(p => em[p.id]?.toLowerCase() === email);
      const uid = prof?.id;
      const meta = uid ? (metaById[uid] || {}) : {};
      const memOv = (uid && sharedDevicePolicyState.mobileOverrides.get(`uid:${uid}`))
        || sharedDevicePolicyState.mobileOverrides.get(`email:${email}`)
        || (appRec.application_id && sharedDevicePolicyState.mobileOverrides.get(`app:${String(appRec.application_id).toUpperCase()}`))
        || null;
      const mobileOverride = memOv
        ? Boolean(memOv.allowed)
        : Boolean(meta.allow_mobile_assessment || appRec.allow_mobile_assessment);
      const mobileOverrideReason = memOv
        ? (memOv.reason || null)
        : (meta.mobile_override_reason || appRec.mobile_override_reason || null);
      const at = attempts.find(a => a.user_id === uid);
      const cp = coupons.find(c => c.user_id === uid);
      const en = enrollments.find(e => e.user_id === uid);
      const sid = en?.student_id || prof?.student_id || appRec.application_id?.replace('PGI-W26-', 'PGI-S26-') || 'PGI-S26-0001';
      const att = attMap[sid] || (uid ? attMap[uid] : null) || { present: 0, absent: 0, hours: 0 };

      const totalDays = att.present + att.absent;
      const attPct = totalDays ? Math.round((att.present / totalDays) * 100) : 0;

      studentDossiers.push({
        id: uid || appRec.id,
        applicationRecordId: appRec.id,
        applicationId: appRec.application_id,
        studentId: sid,
        name: appRec.full_name || prof?.full_name || 'Candidate',
        email,
        phone: appRec.phone || appRec.mobile || prof?.phone || '',
        college: appRec.college || 'Engineering College',
        department: appRec.department || 'Computer Science',
        passedOutYear: appRec.passed_out_year || '2026',
        domainType: appRec.domain_type || 'Technical',
        domainName: appRec.domain_name || 'Full-Stack Web Development',
        mode: appRec.mode || 'Online',
        duration: appRec.duration || '30 Hours',
        internshipPeriod: appRec.internship_period || '1 month',
        referralCode: appRec.referral_code || 'direct',
        whyHire: appRec.why_hire || '',
        address: appRec.address || '',
        status: en ? en.status : (at ? (at.score_percent >= 30 ? 'eligible' : 'failed') : 'applied'),
        score: at?.score_percent ?? null,
        testStatus: at?.status || 'not_attempted',
        coupon: cp ? `${cp.code} (${cp.discount_percent}%)` : null,
        couponStatus: cp?.status || null,
        enrolled: en ? en.status : '',
        paymentAmount: en ? en.amount_paise / 100 : 0,
        paymentRef: en?.transaction_ref || null,
        receiptNo: en?.receipt_no || null,
        attendance: {
          presentDays: att.present,
          absentDays: att.absent,
          completedHours: Number(att.hours.toFixed(1)),
          percentage: attPct,
          meetsCriteria: att.hours >= 30.0 && attPct >= 75.0
        },
        assignedBatchId: appRec.assigned_batch_id || null,
        assignedMentorId: appRec.assigned_mentor_id || null,
        assignedBatch: batchMap[appRec.assigned_batch_id] || 'Winter 2026 Alpha',
        assignedMentor: mentorMap[appRec.assigned_mentor_id] || 'Unassigned',
        mobileOverride,
        mobileOverrideReason,
        appliedAt: appRec.created_at
      });
    });

    // Filtering logic
    const { q, college, department, domain, mode, status } = req.query || {};
    let filtered = studentDossiers;

    if (q) {
      const qLow = q.trim().toLowerCase();
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(qLow) ||
        s.email.toLowerCase().includes(qLow) ||
        s.phone.includes(qLow) ||
        s.studentId.toLowerCase().includes(qLow) ||
        s.applicationId?.toLowerCase().includes(qLow) ||
        s.college.toLowerCase().includes(qLow)
      );
    }

    if (college) {
      filtered = filtered.filter(s => s.college.toLowerCase().includes(college.toLowerCase()));
    }
    if (department) {
      filtered = filtered.filter(s => s.department.toLowerCase().includes(department.toLowerCase()));
    }
    if (domain) {
      filtered = filtered.filter(s => s.domainName.toLowerCase().includes(domain.toLowerCase()) || s.domainType.toLowerCase().includes(domain.toLowerCase()));
    }
    if (mode) {
      filtered = filtered.filter(s => s.mode.toLowerCase() === mode.toLowerCase());
    }
    if (status) {
      filtered = filtered.filter(s => s.status.toLowerCase() === status.toLowerCase());
    }

    res.json(filtered);
  });

  // Add New Candidate / Student Manually from Admin Console
  A('post', '/students', async (req, res) => {
    const b = req.body || {};
    const fullName = String(b.fullName || b.name || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const phoneRaw = String(b.phone || '').replace(/\D/g, '');
    const phoneNorm = phoneRaw.length > 10 ? phoneRaw.slice(-10) : phoneRaw;
    const college = String(b.college || 'Engineering College').trim();
    const department = String(b.department || 'Computer Science').trim();
    const passedOutYear = String(b.passedOutYear || '2026').trim();
    const domainType = b.domainType === 'Non-Technical' ? 'Non-Technical' : 'Technical';
    const domainName = String(b.domainName || 'Web Development').trim();
    const mode = String(b.mode || 'Online').toLowerCase() === 'offline' ? 'Offline' : 'Online';
    const internshipPeriod = String(b.internshipPeriod || '1 month').trim();
    const batchId = b.batchId || null;
    const mentorId = b.mentorId || null;

    if (fullName.length < 2) throw fail(400, 'Candidate full name is required (min 2 chars).');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Please enter a valid email address.');
    if (phoneNorm.length !== 10) throw fail(400, 'Please enter a valid 10-digit mobile number.');

    const { data: existing } = await db
      .from('internship_applications')
      .select('id,application_id')
      .ilike('email', email)
      .maybeSingle()
      .catch(() => ({ data: null }));
    if (existing) throw fail(409, `Candidate with ${email} already exists (${existing.application_id}).`);

    const appId = 'PGI-W26-' + String(Math.floor(1000 + Math.random() * 9000));
    const record = {
      application_id: appId,
      full_name: fullName,
      email,
      phone: phoneNorm,
      phone_norm: phoneNorm,
      college,
      department,
      passed_out_year: passedOutYear,
      domain_type: domainType,
      domain_name: domainName,
      mode,
      duration: '30 Hours',
      internship_period: internshipPeriod,
      address: String(b.address || 'Admin Registered Candidate').trim(),
      why_hire: String(b.whyHire || 'Registered via Admin Control Center.').trim(),
      assigned_batch_id: batchId || null,
      assigned_mentor_id: mentorId || null,
      status: 'submitted'
    };

    const { data, error } = await db.from('internship_applications').insert(record).select().single();
    if (error) throw fail(500, error.message);

    await logAudit(req, 'CREATE_STUDENT', 'student', data?.id || appId, { email, applicationId: appId, domainName });
    res.json({ ok: true, applicationId: appId, student: data });
  });

  // Assign Domain, Batch, Mentor to Student
  A('post', '/students/:id/assign', async (req, res) => {
    const { domainName, domainType, batchId, mentorId, applicationId, applicationRecordId, email } = req.body || {};
    const targetId = req.params.id;
    const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

    const updates = {};
    if (domainName) updates.domain_name = domainName;
    if (domainType) updates.domain_type = domainType;
    if (batchId !== undefined) updates.assigned_batch_id = batchId || null;
    if (mentorId !== undefined) updates.assigned_mentor_id = mentorId || null;

    let resolvedEmail = email ? String(email).trim().toLowerCase() : null;
    if (!resolvedEmail && isUuid(targetId)) {
      try {
        const { data: u } = await db.auth.admin.getUserById(targetId);
        if (u?.user?.email) resolvedEmail = u.user.email.toLowerCase();
      } catch {}
    }

    if (Object.keys(updates).length) {
      try {
        let updated = false;
        if (applicationRecordId && isUuid(applicationRecordId)) {
          const r = await db.from('internship_applications').update(updates).eq('id', applicationRecordId).select('id');
          if (!r.error && r.data?.length) updated = true;
        }
        if (!updated && applicationId) {
          const r = await db.from('internship_applications').update(updates).eq('application_id', applicationId).select('id');
          if (!r.error && r.data?.length) updated = true;
        }
        if (!updated && resolvedEmail) {
          const r = await db.from('internship_applications').update(updates).ilike('email', resolvedEmail).select('id');
          if (!r.error && r.data?.length) updated = true;
        }
        if (!updated && isUuid(targetId)) {
          await db.from('internship_applications').update(updates).eq('id', targetId);
        }
      } catch {}

      if (batchId && isUuid(targetId)) {
        try {
          await db.from('enrollments').update({ batch_id: batchId }).eq('user_id', targetId);
        } catch {}
      }
    }

    await logAudit(req, 'ASSIGN_STUDENT_DETAILS', 'student', targetId, updates);
    res.json({ ok: true, message: 'Student assignments updated successfully.', updates });
  });

  // Update Student Status
  A('post', '/students/:id/status', async (req, res) => {
    const { status } = req.body || {};
    const valid = ['applied', 'eligible', 'enrolled', 'active', 'completed', 'dropped'];
    if (!valid.includes(status)) throw fail(400, `Invalid status. Must be one of: ${valid.join(', ')}`);

    const targetId = req.params.id;
    try {
      await db.from('enrollments').update({ status }).eq('user_id', targetId);
    } catch {}

    await logAudit(req, 'UPDATE_STUDENT_STATUS', 'student', targetId, { status });
    res.json({ ok: true, status });
  });

  // Per-Student Assessment Mobile Override (allow/revoke taking assessment on phone/tablet)
  A('post', '/students/:id/mobile-override', async (req, res) => {
    const b = req.body || {};
    const allowed = Boolean(b.allowed);
    const reason = String(b.reason || '').trim().slice(0, 300);
    if (allowed && reason.length < 3) {
      throw fail(400, 'Please enter a short reason for allowing mobile assessment access.');
    }

    const targetId = String(req.params.id || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const applicationId = String(b.applicationId || '').trim().toUpperCase();

    const record = { allowed, reason: reason || (allowed ? 'Approved by admin' : 'Revoked by admin'), updatedAt: new Date().toISOString() };
    if (targetId) sharedDevicePolicyState.mobileOverrides.set(`uid:${targetId}`, record);
    if (email) sharedDevicePolicyState.mobileOverrides.set(`email:${email}`, record);
    if (applicationId) sharedDevicePolicyState.mobileOverrides.set(`app:${applicationId}`, record);

    let resolvedUserId = null;
    try {
      const { data: uById } = await db.auth.admin.getUserById(targetId);
      if (uById?.user) resolvedUserId = uById.user.id;
    } catch {}
    if (!resolvedUserId && email) {
      try {
        const { data: uList } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const matched = (uList?.users || []).find(u => u.email?.toLowerCase() === email);
        if (matched) resolvedUserId = matched.id;
      } catch {}
    }

    if (resolvedUserId) {
      sharedDevicePolicyState.mobileOverrides.set(`uid:${resolvedUserId}`, record);
      try {
        const { data: uData } = await db.auth.admin.getUserById(resolvedUserId);
        await db.auth.admin.updateUserById(resolvedUserId, {
          user_metadata: {
            ...(uData?.user?.user_metadata || {}),
            allow_mobile_assessment: allowed,
            mobile_override_reason: record.reason,
            mobile_override_at: record.updatedAt
          }
        });
      } catch {}
    }

    try {
      if (applicationId) {
        await db.from('internship_applications')
          .update({ allow_mobile_assessment: allowed, mobile_override_reason: record.reason })
          .eq('application_id', applicationId);
      } else if (email) {
        await db.from('internship_applications')
          .update({ allow_mobile_assessment: allowed, mobile_override_reason: record.reason })
          .ilike('email', email);
      }
    } catch {}

    await logAudit(req, 'ASSESSMENT_MOBILE_OVERRIDE', 'student', applicationId || resolvedUserId || targetId, {
      application_id: applicationId || null,
      user_id: resolvedUserId || targetId,
      email: email || null,
      allowed,
      reason: record.reason
    });

    res.json({
      ok: true,
      allowed,
      reason: record.reason,
      message: allowed
        ? `Mobile assessment override enabled (${record.reason}).`
        : 'Mobile assessment override revoked (Desktop-only enforced).'
    });
  });

  // Remove ALL Student & Candidate Details (Preserves admin accounts, mentors, batches, questions, courses & settings)
  A('delete', '/students', async (req, res) => {
    const adminIds = new Set();
    if (req.user?.id) adminIds.add(req.user.id);
    try {
      const { data: adminProfs } = await db.from('profiles').select('id,role').eq('role', 'admin');
      (adminProfs || []).forEach(p => { if (p?.id) adminIds.add(p.id); });
    } catch {}

    const tablesToClear = [
      { table: 'certificates', col: 'id' },
      { table: 'student_attendance', col: 'id' },
      { table: 'student_assignments', col: 'id' },
      { table: 'student_projects', col: 'id' },
      { table: 'proctoring_violations', col: 'id' },
      { table: 'student_queries', col: 'id' },
      { table: 'password_resets', col: 'id' },
      { table: 'enrollments', col: 'id' },
      { table: 'payment_orders', col: 'id' },
      { table: 'assessment_attempts', col: 'id' },
      { table: 'internship_applications', col: 'id' }
    ];

    const clearedTables = [];
    for (const item of tablesToClear) {
      try {
        const { error } = await db.from(item.table).delete().not(item.col, 'is', null);
        if (!error) clearedTables.push(item.table);
      } catch {}
    }

    // Clear student-issued coupons while preserving PGITEST1 test coupon config
    try {
      const { error } = await db.from('scholarship_coupons').delete().neq('code', TEST_COUPON_CODE);
      if (!error) clearedTables.push('scholarship_coupons');
    } catch {}

    // Reset batch enrolled counts
    try {
      await db.from('batches').update({ enrolled_count: 0 }).not('id', 'is', null);
      bustBatchCache?.();
    } catch {}

    // Delete non-admin profiles & auth accounts
    let deletedAuthUsers = 0;
    try {
      await db.from('profiles').delete().neq('role', 'admin');
    } catch {}
    try {
      const { data: userList } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      for (const u of userList?.users || []) {
        if (!u?.id || adminIds.has(u.id)) continue;
        try {
          const { error: delErr } = await db.auth.admin.deleteUser(u.id);
          if (!delErr) deletedAuthUsers++;
        } catch {}
      }
    } catch {}

    localCertificates.clear();
    if (Array.isArray(sharedSupportTickets)) sharedSupportTickets.length = 0;

    await logAudit(req, 'PURGE_ALL_STUDENTS', 'students', 'all', { deletedAuthUsers, clearedTables });
    res.json({ ok: true, deletedAuthUsers, clearedTables });
  });

  // ===================================================================
  // 3. ASSESSMENTS & QUESTIONS MANAGEMENT
  // ===================================================================
  A('get', '/questions', async (_q, res) => {
    const { data, error } = await db.from('questions').select('*').order('created_at', { ascending: false, nullsFirst: false }).limit(500);
    if (error) {
      const { data: d2 } = await db.from('questions').select('*').limit(500);
      return res.json(d2 || []);
    }
    res.json(data || []);
  });

  A('post', '/questions', async (req, res) => {
    const b = req.body || {};
    const text = String(b.text || '').trim();
    if (text.length < 5) throw fail(400, 'Question text must be at least 5 characters');
    const options = Array.isArray(b.options) ? b.options : [];
    if (options.length < 2) throw fail(400, 'At least 2 options are required');
    const correctOptionId = String(b.correct_option_id || b.correctOptionId || '').trim();
    if (!options.some(o => o.id === correctOptionId)) throw fail(400, 'Correct option must be one of the provided options');
    const marks = Math.max(1, Math.min(50, Number(b.marks || 5)));
    const questionSet = Math.max(1, Number(b.question_set || b.questionSet || 1));
    const active = b.active !== false;

    const { data, error } = await db.from('questions').insert({
      text,
      options,
      correct_option_id: correctOptionId,
      marks,
      question_set: questionSet,
      active
    }).select().single();
    if (error) throw fail(500, error.message);

    await logAudit(req, 'CREATE_QUESTION', 'question', data.id, { text, marks, correctOptionId });
    res.json(data);
  });

  A('post', '/questions/:id', async (req, res) => {
    const b = req.body || {};
    const updates = {};
    if (b.text !== undefined) updates.text = String(b.text).trim();
    if (b.options !== undefined && Array.isArray(b.options)) updates.options = b.options;
    if (b.correct_option_id !== undefined || b.correctOptionId !== undefined) {
      updates.correct_option_id = String(b.correct_option_id ?? b.correctOptionId).trim();
    }
    if (b.marks !== undefined) updates.marks = Number(b.marks);
    if (b.active !== undefined) updates.active = Boolean(b.active);
    if (b.question_set !== undefined || b.questionSet !== undefined) updates.question_set = Number(b.question_set ?? b.questionSet);

    const { data, error } = await db.from('questions').update(updates).eq('id', req.params.id).select().single();
    if (error) throw fail(500, error.message);

    await logAudit(req, 'UPDATE_QUESTION', 'question', req.params.id, updates);
    res.json(data);
  });

  A('delete', '/questions/:id', async (req, res) => {
    const { error } = await db.from('questions').delete().eq('id', req.params.id);
    if (error) throw fail(500, error.message);

    await logAudit(req, 'DELETE_QUESTION', 'question', req.params.id);
    res.json({ ok: true, deleted: req.params.id });
  });

  A('post', '/questions/:id/toggle', async (req, res) => {
    const { data: q } = await db.from('questions').select('active').eq('id', req.params.id).maybeSingle();
    if (!q) throw fail(404, 'Question not found');
    const { data, error } = await db.from('questions').update({ active: !q.active }).eq('id', req.params.id).select().single();
    if (error) throw fail(500, error.message);

    await logAudit(req, 'TOGGLE_QUESTION', 'question', req.params.id, { active: data.active });
    res.json({ ok: true, active: data.active });
  });

  // Settings
  A('get', '/settings', async (_q, res) => {
    let s = null;
    try {
      const { data } = await db.from('test_settings').select('*').eq('id', 1).maybeSingle();
      s = data;
    } catch {}
    const desktopOnly = await resolveDesktopOnlyFlag(s);
    res.json({
      ...(s || {
        id: 1,
        question_count: 25,
        duration_seconds: 1200,
        marks_per_question: 4,
        total_marks: 100,
        pass_mark: 30,
        negative_marking: 0,
        attempt_limit: 1,
        coupon_valid_hours: 24
      }),
      desktop_only: desktopOnly
    });
  });

  A('post', '/settings', async (req, res) => {
    const b = req.body || {};
    let cur = null;
    try {
      const { data } = await db.from('test_settings').select('*').eq('id', 1).maybeSingle();
      cur = data;
    } catch {}
    const curDesktopOnly = await resolveDesktopOnlyFlag(cur);
    const nextDesktopOnly = (b.desktop_only !== undefined || b.desktopOnly !== undefined)
      ? Boolean(b.desktop_only ?? b.desktopOnly)
      : curDesktopOnly;

    const coreUpdates = {
      pass_mark: Math.max(0, Math.min(100, Number(b.pass_mark ?? b.passMark ?? cur?.pass_mark ?? 30))),
      total_marks: Math.max(10, Math.min(500, Number(b.total_marks ?? b.totalMarks ?? cur?.total_marks ?? 100))),
      question_count: Math.max(1, Math.min(100, Number(b.question_count ?? b.questionCount ?? cur?.question_count ?? 25))),
      marks_per_question: Math.max(1, Math.min(50, Number(b.marks_per_question ?? b.marksPerQuestion ?? cur?.marks_per_question ?? 4))),
      duration_seconds: Math.max(60, Math.min(14400, Number(b.duration_seconds ?? (b.durationMinutes ? b.durationMinutes * 60 : (cur?.duration_seconds ?? 1200))))),
      negative_marking: Math.max(0, Math.min(10, Number(b.negative_marking ?? b.negativeMarking ?? cur?.negative_marking ?? 0))),
      attempt_limit: Math.max(1, Math.min(10, Number(b.attempt_limit ?? b.attemptLimit ?? cur?.attempt_limit ?? 1))),
      coupon_valid_hours: Math.max(1, Math.min(168, Number(b.coupon_valid_hours ?? b.couponValidHours ?? cur?.coupon_valid_hours ?? 24)))
    };

    sharedDevicePolicyState.desktopOnlyOverride = nextDesktopOnly;

    let saved = null;
    let err = null;
    ({ data: saved, error: err } = await db.from('test_settings').update({ ...coreUpdates, desktop_only: nextDesktopOnly }).eq('id', 1).select().maybeSingle());
    if (err && /column|desktop_only|schema cache|PGRST204/i.test(err.message || '')) {
      ({ data: saved, error: err } = await db.from('test_settings').update(coreUpdates).eq('id', 1).select().maybeSingle());
    }
    if (err) throw fail(500, err.message);

    const auditPayload = { ...coreUpdates, desktop_only: nextDesktopOnly };
    await logAudit(req, 'UPDATE_TEST_SETTINGS', 'settings', '1', auditPayload);
    res.json({ ok: true, settings: { ...(saved || coreUpdates), desktop_only: nextDesktopOnly } });
  });

  // Export assessment results to CSV
  A('get', '/attempts/export.csv', async (req, res) => {
    const B = await scope(req);
    const { em, by } = await people();
    const attempts = await rows(S(B, db.from('assessment_attempts').select('*').order('started_at', { ascending: false }).limit(50000)));

    const headers = ['Candidate Name', 'Email', 'Started At', 'Submitted At', 'Status', 'Correct Count', 'Total Questions', 'Score %', 'Result'];
    const csvRows = [headers.join(',')];

    attempts.forEach(a => {
      const name = `"${(by[a.user_id]?.full_name || 'Candidate').replace(/"/g, '""')}"`;
      const email = `"${(em[a.user_id] || '').replace(/"/g, '""')}"`;
      const started = a.started_at ? `"${new Date(a.started_at).toLocaleString('en-IN')}"` : '""';
      const submitted = a.submitted_at ? `"${new Date(a.submitted_at).toLocaleString('en-IN')}"` : '""';
      const status = `"${a.status}"`;
      const correct = a.correct_count ?? 0;
      const total = a.total_questions ?? 20;
      const score = a.score_percent ?? 0;
      const result = score >= 30 ? '"Qualified (Scholarship Unlocked)"' : '"Not Qualified"';
      csvRows.push([name, email, started, submitted, status, correct, total, score, result].join(','));
    });

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="assessment-results.csv"'
    }).send(csvRows.join('\n'));
  });

  // ===================================================================
  // 4. PAYMENTS & CSV EXPORT (Excludes is_test records by default unless ?includeTest=1)
  // ===================================================================
  A('get', '/payments', async (req, res) => {
    const B = await scope(req);
    const includeTest = req.query?.includeTest === '1' || req.query?.includeTest === 'true';
    const { by, em } = await people();
    const [courseList, appList, rawOrders] = await Promise.all([
      rows(db.from('courses').select('id,title')),
      rows(db.from('internship_applications').select('email,domain_name').limit(5000)).catch(() => []),
      rows(S(B, db.from('payment_orders').select('*')).order('created_at', { ascending: false }).limit(5000))
    ]);
    const courses = Object.fromEntries(courseList.map(c => [c.id, c.title]));
    const domainByEmail = {};
    appList.forEach(a => {
      const k = String(a.email || '').trim().toLowerCase();
      if (k && a.domain_name && !domainByEmail[k]) domainByEmail[k] = a.domain_name;
    });
    const orders = includeTest ? rawOrders : rawOrders.filter(o => !isTestTransactionRecord(o));

    res.json(orders.map(o => {
      const email = em[o.user_id] || '';
      const isTest = isTestTransactionRecord(o);
      return {
        id: o.id,
        name: by[o.user_id]?.full_name || 'Candidate',
        email,
        course: courses[o.course_id] || domainByEmail[String(email).toLowerCase()] || 'Winter Internship 2026',
        amountPaise: o.amount_paise,
        amountRupees: o.amount_paise / 100,
        status: o.status,
        orderId: o.razorpay_order_id,
        paymentId: o.razorpay_payment_id || null,
        couponCode: o.coupon_code || null,
        isTest,
        created: o.created_at,
        paidAt: o.paid_at || null
      };
    }));
  });

  A('get', '/payments/export.csv', async (req, res) => {
    const B = await scope(req);
    const includeTest = req.query?.includeTest === '1' || req.query?.includeTest === 'true';
    const { by, em } = await people();
    const courses = Object.fromEntries((await rows(db.from('courses').select('id,title'))).map(c => [c.id, c.title]));
    const rawOrders = await rows(S(B, db.from('payment_orders').select('*')).order('created_at', { ascending: false }).limit(50000));
    const orders = includeTest ? rawOrders : rawOrders.filter(o => !isTestTransactionRecord(o));

    const headers = ['Order ID', 'Payment ID', 'Candidate Name', 'Email', 'Track', 'Amount (INR)', 'Status', 'Created At', 'Paid At'];
    const csvRows = [headers.join(',')];

    orders.forEach(o => {
      const orderId = `"${o.razorpay_order_id || o.id}"`;
      const payId = `"${o.razorpay_payment_id || ''}"`;
      const name = `"${(by[o.user_id]?.full_name || 'Candidate').replace(/"/g, '""')}"`;
      const email = `"${(em[o.user_id] || '').replace(/"/g, '""')}"`;
      const course = `"${(courses[o.course_id] || 'Winter Internship').replace(/"/g, '""')}"`;
      const amount = o.amount_paise / 100;
      const status = `"${o.status}"`;
      const created = o.created_at ? `"${new Date(o.created_at).toLocaleString('en-IN')}"` : '""';
      const paid = o.paid_at ? `"${new Date(o.paid_at).toLocaleString('en-IN')}"` : '""';
      csvRows.push([orderId, payId, name, email, course, amount, status, created, paid].join(','));
    });

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="pgi-payments.csv"'
    }).send(csvRows.join('\n'));
  });

  // ===================================================================
  // 5. COUPONS (List, Reissue, Revoke, Toggle, Delete)
  // ===================================================================
  A('get', '/coupons', async (req, res) => {
    const B = await scope(req);
    const { by, em } = await people();
    const [scopedCoupons, testCoupons] = await Promise.all([
      rows(S(B, db.from('scholarship_coupons').select('*')).order('issued_at', { ascending: false }).limit(5000)),
      fetchTestCouponsForAdmin(db)
    ]);

    const merged = [];
    const seen = new Set();
    for (const c of [...testCoupons, ...scopedCoupons]) {
      const key = String(c.code || c.id).toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(c);
    }

    const now = new Date();
    res.json(merged.map(c => {
      const meta = formatTestCouponMeta(c);
      let resolvedStatus = c.status || 'active';
      if (!meta.isTest && resolvedStatus === 'active' && new Date(c.expires_at) < now) {
        resolvedStatus = 'expired';
      }

      return {
        id: c.id,
        code: c.code,
        name: meta.isTest ? 'System Test Coupon' : (by[c.user_id]?.full_name || 'Candidate'),
        email: meta.isTest ? 'All Accounts (Reusable)' : (em[c.user_id] || c.student_email || ''),
        discount: c.discount_percent,
        score: c.score_percent,
        issued: c.issued_at,
        expires: meta.isTest ? null : c.expires_at,
        status: resolvedStatus,
        redeemed: c.redeemed_at || null,
        ...meta
      };
    }));
  });

  A('post', '/coupons/:code/reissue', async (req, res) => {
    const code = req.params.code;
    const hours = Math.max(1, Math.min(168, Number(req.body?.hours || 24)));
    const newExpires = new Date(Date.now() + hours * 3600e3).toISOString();

    const { data, error } = await db.from('scholarship_coupons')
      .update({ expires_at: newExpires, status: 'active', reissued_at: new Date().toISOString() })
      .ilike('code', code)
      .select().maybeSingle();

    if (error) throw fail(500, error.message);
    if (!data) throw fail(404, `Coupon "${code}" not found.`);

    await logAudit(req, 'REISSUE_COUPON', 'coupon', code, { hours, newExpires });
    res.json({ ok: true, code, expiresAt: newExpires });
  });

  A('post', '/coupons/:code/revoke', async (req, res) => {
    const code = req.params.code;
    const updated = await setCouponStatusInStore(db, code, 'revoked');
    if (!updated) throw fail(404, `Coupon "${code}" not found.`);

    await logAudit(req, 'REVOKE_COUPON', 'coupon', code);
    res.json({ ok: true, message: `Coupon ${code} revoked.`, status: updated.status });
  });

  A('post', '/coupons/:code/toggle', async (req, res) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const existing = await resolveCouponByCode(db, code);
    if (!existing) throw fail(404, `Coupon "${code}" not found.`);

    const nextStatus = existing.status === 'active' ? 'disabled' : 'active';
    const updated = await setCouponStatusInStore(db, code, nextStatus);
    if (!updated) throw fail(500, `Unable to update coupon ${code}.`);

    await logAudit(req, 'TOGGLE_COUPON', 'coupon', code, { status: updated.status });
    res.json({ ok: true, code, status: updated.status });
  });

  A('delete', '/coupons/:code', async (req, res) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const out = await deleteCouponByCode(db, code);
    if (out.notFound) throw fail(404, `Coupon "${code}" not found.`);
    if (out.error) throw fail(500, out.error.message || 'Unable to delete coupon.');

    await logAudit(req, 'DELETE_COUPON', 'coupon', code, { deleted: true });
    res.json({ ok: true, code, deleted: true });
  });

  // ===================================================================
  // 6. PROGRAMS & BATCHES (Dates, Mode, Timings, Seats)
  // ===================================================================
  const slugify = n => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

  A('get', '/batches', async (_q, res) => {
    res.json(await rows(db.from('batches').select('*').order('starts_on', { ascending: false, nullsFirst: true })));
  });

  A('post', '/batches', async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (name.length < 2) throw fail(400, 'Batch name is required');
    const mode = b.mode || 'Online & Offline';
    const timings = b.timings || (mode.toLowerCase().includes('offline') ? '9:00 AM – 6:00 PM' : '4:00 PM – 6:00 PM');
    const seatsLimit = Math.max(1, Number(b.seats_limit || b.seatsLimit || 60));

    const { data, error } = await db.from('batches').insert({
      name,
      slug: slugify(name),
      starts_on: b.starts_on || null,
      ends_on: b.ends_on || null,
      description: b.description || 'Winter 2026 Batch',
      mode,
      timings,
      seats_limit: seatsLimit,
      status: 'upcoming'
    }).select().single();

    if (error) throw fail(500, error.message);
    await logAudit(req, 'CREATE_BATCH', 'batch', data.id, { name, mode, timings, seatsLimit });
    bustBatchCache();
    res.json(data);
  });

  A('post', '/batches/:id', async (req, res) => {
    const B = await resolveBatch(req.params.id);
    const b = req.body || {};
    const updates = {};
    if (b.name) { updates.name = b.name; updates.slug = slugify(b.name); }
    if (b.starts_on !== undefined) updates.starts_on = b.starts_on || null;
    if (b.ends_on !== undefined) updates.ends_on = b.ends_on || null;
    if (b.mode) updates.mode = b.mode;
    if (b.timings) updates.timings = b.timings;
    if (b.seats_limit || b.seatsLimit) updates.seats_limit = Number(b.seats_limit || b.seatsLimit);
    if (b.description !== undefined) updates.description = b.description;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await db.from('batches').update(updates).eq('id', B.id).select().single();
    if (error) throw fail(500, error.message);

    await logAudit(req, 'UPDATE_BATCH', 'batch', B.id, updates);
    bustBatchCache();
    res.json(data);
  });

  A('post', '/batches/:id/status', async (req, res) => {
    const s = req.body?.status;
    if (!['upcoming', 'active', 'inactive', 'completed'].includes(s)) throw fail(400, 'Invalid status');
    const B = await resolveBatch(req.params.id);

    const { data, error } = await db.from('batches').update({ status: s, updated_at: new Date().toISOString() }).eq('id', B.id).select().single();
    if (error) throw fail(500, error.message);

    await logAudit(req, 'UPDATE_BATCH_STATUS', 'batch', B.id, { status: s });
    bustBatchCache();
    res.json(data);
  });

  // ===================================================================
  // 7. MENTORS MANAGEMENT
  // ===================================================================
  A('get', '/mentors', async (_q, res) => {
    try {
      const { data, error } = await db.from('mentors').select('*').order('created_at', { ascending: true });
      if (!error) return res.json(data || []);
    } catch {}
    res.json(localMentors);
  });

  A('post', '/mentors', async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const domain = String(b.domain || '').trim();
    if (!name || !email || !domain) throw fail(400, 'Name, email, and domain are required.');

    const mentorObj = {
      name,
      email,
      phone: b.phone || '',
      domain,
      title: b.title || 'Senior Academic Mentor',
      bio: b.bio || '',
      active: b.active !== false
    };

    let saved = null;
    try {
      const { data, error } = await db.from('mentors').insert(mentorObj).select().single();
      if (!error && data) saved = data;
    } catch {}

    if (!saved) {
      saved = { id: `m-${Date.now()}`, ...mentorObj };
      localMentors.push(saved);
    }

    await logAudit(req, 'CREATE_MENTOR', 'mentor', saved.id, { name, domain, email });
    res.json(saved);
  });

  A('delete', '/mentors/:id', async (req, res) => {
    const mentorId = String(req.params.id || '').trim();
    if (!mentorId) throw fail(400, 'Mentor ID is required.');

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mentorId);
    let removedName = '';

    // Unassign mentor from applications & support queries before deleting (avoids FK constraint errors)
    try {
      await db.from('internship_applications').update({ assigned_mentor_id: null }).eq('assigned_mentor_id', mentorId);
    } catch {}
    try {
      await db.from('student_queries').update({ assigned_mentor_id: null }).eq('assigned_mentor_id', mentorId);
    } catch {}
    if (Array.isArray(sharedSupportTickets)) {
      sharedSupportTickets.forEach(t => {
        if (String(t.assignedMentorId || '') === mentorId) {
          t.assignedMentorId = null;
          t.assignedMentorName = null;
        }
      });
    }

    if (isUuid) {
      const { data: existing } = await db.from('mentors').select('name').eq('id', mentorId).maybeSingle();
      if (existing?.name) removedName = existing.name;
      const { error } = await db.from('mentors').delete().eq('id', mentorId);
      if (error) throw fail(500, error.message);
    }

    const localIdx = localMentors.findIndex(m => String(m.id) === mentorId);
    if (localIdx >= 0) {
      if (!removedName) removedName = localMentors[localIdx].name;
      localMentors.splice(localIdx, 1);
    }

    await logAudit(req, 'REMOVE_MENTOR', 'mentor', mentorId, { name: removedName || mentorId });
    res.json({ ok: true, deleted: mentorId, name: removedName || null });
  });

  // ===================================================================
  // 8. NOTIFICATIONS & BROADCASTS
  // ===================================================================
  A('get', '/notifications', async (_q, res) => {
    let list = [];
    try {
      const { data } = await db.from('notifications').select('*').order('created_at', { ascending: false });
      if (data && data.length) list = data;
    } catch {}
    res.json(list.length ? list : localNotifications);
  });

  A('post', '/notifications', async (req, res) => {
    const { title, message, targetTrack, targetMode, priority } = req.body || {};
    if (!title || !message) throw fail(400, 'Title and message are required');

    const notif = {
      title,
      message,
      target_track: targetTrack || 'all',
      target_mode: targetMode || 'all',
      priority: priority || 'normal',
      created_by: req.user?.id || null,
      created_at: new Date().toISOString()
    };

    let saved = null;
    try {
      const { data, error } = await db.from('notifications').insert(notif).select().single();
      if (!error && data) saved = data;
    } catch {}

    if (!saved) {
      saved = { id: `n-${Date.now()}`, ...notif };
      localNotifications.unshift(saved);
    }

    await logAudit(req, 'BROADCAST_NOTIFICATION', 'notification', saved.id, { title, priority });
    res.json({ ok: true, notification: saved });
  });

  // ===================================================================
  // 9. CERTIFICATES ENGINE (Strict 30-Hour Criteria Enforcement & PDF)
  // ===================================================================
  A('get', '/certificates', async (_q, res) => {
    let certs = [];
    try {
      const { data } = await db.from('certificates').select('*').order('issued_at', { ascending: false });
      if (data && data.length) certs = data;
    } catch {}

    if (!certs.length && localCertificates.size) {
      certs = Array.from(localCertificates.values());
    }
    res.json(certs);
  });

  // Check student certificate eligibility
  A('get', '/certificates/eligibility/:studentId', async (req, res) => {
    const rawId = req.params.studentId;
    const mode = String(req.query?.mode || '');
    const isCompletedOffline = mode.toLowerCase().includes('completed offline');

    let attRecords = [];
    try {
      const { data } = await db.from('student_attendance').select('*').eq('student_id', rawId);
      if (data && data.length) attRecords = data;
    } catch {}

    const presentDays = attRecords.filter(r => r.status === 'present').length;
    const absentDays = attRecords.filter(r => r.status === 'absent').length;
    const rawCompletedHours = attRecords.filter(r => r.status === 'present').reduce((sum, r) => sum + Number(r.hours_logged || 0), 0);
    const rawAttendancePct = Number(((presentDays / (presentDays + absentDays || 1)) * 100).toFixed(1));

    const check = verifyCertificateEligibility({
      completedHours: rawCompletedHours,
      attendancePercentage: rawAttendancePct,
      totalRequiredHours: 30.0,
      mode
    });
    res.json({
      studentId: rawId,
      completedHours: isCompletedOffline ? Math.max(rawCompletedHours, 30.0) : rawCompletedHours,
      totalRequiredHours: 30.0,
      attendancePercentage: isCompletedOffline ? (rawAttendancePct > 0 ? rawAttendancePct : 100.0) : rawAttendancePct,
      presentDays,
      absentDays,
      completedOffline: isCompletedOffline,
      eligible: check.eligible,
      reason: check.reason || null
    });
  });

  // Issue Certificate (Strictly gated by 30-hour completion requirement unless Completed Offline)
  A('post', '/certificates/issue', async (req, res) => {
    const { studentId, studentName, domain, college, mode } = req.body || {};
    if (!studentId) throw fail(400, 'Student ID is required');

    const isCompletedOffline = String(mode || '').toLowerCase().includes('completed offline');

    // Retrieve verified attendance from DB
    let attRecords = [];
    try {
      const { data } = await db.from('student_attendance').select('*').eq('student_id', studentId);
      if (data && data.length) attRecords = data;
    } catch {}

    const presentDays = attRecords.filter(r => r.status === 'present').length;
    const absentDays = attRecords.filter(r => r.status === 'absent').length;
    const rawCompletedHours = attRecords.filter(r => r.status === 'present').reduce((sum, r) => sum + Number(r.hours_logged || 0), 0);
    const rawAttendancePct = attRecords.length ? Number(((presentDays / (presentDays + absentDays || 1)) * 100).toFixed(1)) : 0;

    // CRITICAL ENFORCEMENT GATE: Verify completion criteria (bypassed only when Completed Offline is verified by admin)
    const check = verifyCertificateEligibility({
      completedHours: rawCompletedHours,
      attendancePercentage: rawAttendancePct,
      totalRequiredHours: 30.0,
      mode
    });
    if (!check.eligible) {
      throw fail(400, check.reason || 'Completion criteria not met: Candidate must fulfill 30 verified training hours and >= 75% attendance.');
    }

    const completedHours = isCompletedOffline ? Math.max(rawCompletedHours, 30.0) : rawCompletedHours;
    const attendancePercentage = isCompletedOffline ? (rawAttendancePct > 0 ? rawAttendancePct : 100.0) : rawAttendancePct;

    const certId = certificateNumber(studentId);
    const certRecord = {
      certificate_id: certId,
      student_id: studentId,
      student_name: studentName || 'Candidate',
      domain: domain || 'Full-Stack Web Development Track',
      duration: '30 Hours',
      completed_hours: completedHours,
      attendance_percentage: attendancePercentage,
      issued_at: new Date().toISOString(),
      issued_by: req.user?.id || null,
      verification_url: `https://plantgreeninertia.com/verify/${certId}`,
      status: 'issued'
    };

    try {
      await db.from('certificates').upsert(certRecord, { onConflict: 'certificate_id' });
    } catch {}
    localCertificates.set(certId, certRecord);

    await logAudit(req, 'ISSUE_CERTIFICATE', 'certificate', certId, {
      studentId,
      mode: mode || 'Online (30 Hours)',
      completedOffline: isCompletedOffline,
      completedHours,
      attendancePercentage
    });
    res.json({ ok: true, message: `Certificate ${certId} issued successfully.`, certificate: certRecord });
  });

  // Download official landscape certificate PDF
  A('get', '/certificates/:certId/download.pdf', async (req, res) => {
    const certId = req.params.certId;
    let cert = null;
    try {
      const { data } = await db.from('certificates').select('*').eq('certificate_id', certId).maybeSingle();
      cert = data;
    } catch {}

    if (!cert && localCertificates.has(certId)) {
      cert = localCertificates.get(certId);
    }

    if (!cert) {
      // Allow preview generator if not found in table
      cert = {
        certificate_id: certId,
        student_id: certId.replace('PGI-W26-CERT-', 'PGI-S26-'),
        student_name: 'Priya Sundaram',
        domain: 'Full-Stack Web Development Track',
        duration: '30 Hours',
        completed_hours: 30.0,
        attendance_percentage: 92.5,
        verification_url: `https://plantgreeninertia.com/verify/${certId}`
      };
    }

    const pdfBuffer = await buildCertificatePDF({
      certificateNumber: cert.certificate_id,
      studentId: cert.student_id,
      studentName: cert.student_name,
      domain: cert.domain,
      duration: cert.duration || '30 Hours',
      attendancePercentage: cert.attendance_percentage,
      completionDate: new Date(cert.issued_at || Date.now()).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }),
      verificationUrl: cert.verification_url
    });

    sendPdf(res, pdfBuffer, `${certId}.pdf`);
  });

  // ===================================================================
  // 9B. PROCTORING ATTEMPTS, ATTENDANCE & SUBMISSIONS REVIEW
  // ===================================================================
  A('get', '/attempts', async (req, res) => {
    const B = await scope(req);
    const { em, by } = await people();
    const [attempts, rawViols, coupons] = await Promise.all([
      rows(S(B, db.from('assessment_attempts').select('id,batch_id,user_id,status,correct_count,total_questions,score_percent,started_at,submitted_at,application_id')).order('started_at', { ascending: false }).limit(500)),
      db.from('proctoring_violations').select('attempt_id,type,counted,occurred_at').limit(10000).then(r => r.data || []).catch(() => []),
      rows(S(B, db.from('scholarship_coupons').select('attempt_id,code,discount_percent,status')).limit(5000)).catch(() => [])
    ]);

    const violMap = {};
    for (const v of rawViols) {
      if (!violMap[v.attempt_id]) {
        violMap[v.attempt_id] = { total: 0, strikes: 0, types: {}, latestType: null, latestAt: null };
      }
      const bucket = violMap[v.attempt_id];
      bucket.total += 1;
      if (v.counted !== false) bucket.strikes += 1;
      const tKey = String(v.type || 'other');
      bucket.types[tKey] = (bucket.types[tKey] || 0) + 1;
      if (!bucket.latestAt || (v.occurred_at && v.occurred_at > bucket.latestAt)) {
        bucket.latestAt = v.occurred_at || bucket.latestAt;
        bucket.latestType = tKey;
      }
    }
    const coupByAttempt = Object.fromEntries((coupons || []).map(c => [c.attempt_id, c]));

    res.json(attempts.map(a => {
      const c = coupByAttempt[a.id];
      const vm = violMap[a.id] || { total: 0, strikes: 0, types: {}, latestType: null, latestAt: null };
      const topType = Object.entries(vm.types).sort((x, y) => y[1] - x[1])[0]?.[0] || vm.latestType;
      return {
        id: a.id,
        applicationId: a.application_id || null,
        name: by[a.user_id]?.full_name || 'Candidate',
        email: em[a.user_id] || '',
        status: a.status,
        correctCount: a.correct_count ?? 0,
        totalQuestions: a.total_questions ?? 25,
        scorePercent: Number(a.score_percent ?? 0),
        strikes: vm.strikes,
        violationEvents: vm.total,
        violationBreakdown: vm.types,
        topViolationType: topType || null,
        topViolationLabel: topType ? (VIOLATION_LABELS?.[topType] || topType) : null,
        lastViolationAt: vm.latestAt,
        couponCode: c?.code || null,
        couponDiscount: c?.discount_percent ?? null,
        startedAt: a.started_at,
        submittedAt: a.submitted_at
      };
    }));
  });

  A('get', '/attempts/:id/violations', async (req, res) => {
    const { data, error } = await db
      .from('proctoring_violations')
      .select('id,attempt_id,type,counted,occurred_at,snapshot')
      .eq('attempt_id', req.params.id)
      .order('occurred_at', { ascending: true });
    if (error) throw fail(500, error.message);

    res.json((data || []).map(v => ({
      ...v,
      counted: v.counted !== false,
      label: VIOLATION_LABELS?.[v.type] || v.type
    })));
  });

  A('get', '/attendance', async (req, res) => {
    const sid = String(req.query?.studentId || '').trim();
    try {
      let q = db.from('student_attendance').select('*').order('date', { ascending: false }).limit(500);
      if (sid) q = q.eq('student_id', sid);
      const { data, error } = await q;
      if (error) throw error;
      return res.json(data || []);
    } catch {
      return res.json([]);
    }
  });

  A('post', '/attendance', async (req, res) => {
    const b = req.body || {};
    const studentId = String(b.studentId || '').trim().toUpperCase();
    if (!studentId) throw fail(400, 'Student ID is required');
    const dayNumber = Math.max(1, Math.min(30, Number(b.dayNumber || 1)));
    const status = ['present', 'absent', 'late', 'excused', 'holiday'].includes(b.status) ? b.status : 'present';
    const mode = String(b.mode || 'Online').toLowerCase() === 'offline' ? 'Offline' : 'Online';
    const hoursLogged = status === 'present'
      ? Math.max(0.5, Math.min(12, Number(b.hoursLogged ?? 3.0)))
      : (status === 'late' ? Math.max(0, Math.min(12, Number(b.hoursLogged ?? 2.0))) : 0);
    const sessionTitle = String(b.sessionTitle || `Day ${dayNumber} Cohort Session`).trim().slice(0, 160);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : new Date().toISOString().slice(0, 10);
    const remarks = String(b.remarks || '').trim().slice(0, 300) || null;

    let userId = null;
    try {
      const { data: enr } = await db.from('enrollments').select('user_id').eq('student_id', studentId).maybeSingle();
      userId = enr?.user_id || null;
      if (!userId) {
        const { data: prof } = await db.from('profiles').select('id').eq('student_id', studentId).maybeSingle();
        userId = prof?.id || null;
      }
    } catch {}

    const record = {
      student_id: studentId,
      user_id: userId,
      date,
      day_number: dayNumber,
      session_title: sessionTitle,
      mode,
      status,
      hours_logged: hoursLogged,
      verification_method: 'admin_console',
      remarks
    };

    let saved = null;
    const { data: existing } = await db
      .from('student_attendance')
      .select('id')
      .eq('student_id', studentId)
      .eq('day_number', dayNumber)
      .maybeSingle();

    if (existing?.id) {
      const { data, error } = await db.from('student_attendance').update(record).eq('id', existing.id).select().single();
      if (error) throw fail(500, error.message);
      saved = data;
    } else {
      const { data, error } = await db.from('student_attendance').insert(record).select().single();
      if (error) throw fail(500, error.message);
      saved = data;
    }

    await logAudit(req, 'LOG_ATTENDANCE', 'student', studentId, { dayNumber, status, hoursLogged, date });
    res.json({ ok: true, record: saved });
  });

  A('get', '/submissions', async (_q, res) => {
    const { by, em } = await people();
    try {
      const { data, error } = await db
        .from('student_assignments')
        .select('*')
        .order('submitted_at', { ascending: false, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return res.json((data || []).map(item => ({
        ...item,
        studentName: by[item.user_id]?.full_name || 'Student',
        studentEmail: em[item.user_id] || ''
      })));
    } catch {
      return res.json([]);
    }
  });

  A('post', '/submissions/:id/review', async (req, res) => {
    const { status, score, feedback } = req.body || {};
    const valid = ['pending', 'submitted', 'reviewed'];
    const updates = {};
    if (status && valid.includes(status)) updates.status = status;
    else updates.status = 'reviewed';
    if (score !== undefined && score !== null && score !== '') {
      updates.score = Math.max(0, Math.min(100, Number(score)));
    }
    if (feedback !== undefined) updates.feedback = String(feedback || '').trim().slice(0, 1000);

    const { data, error } = await db
      .from('student_assignments')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();
    if (error) throw fail(500, error.message);
    if (!data) throw fail(404, 'Submission record not found');

    await logAudit(req, 'REVIEW_SUBMISSION', 'submission', req.params.id, { status: updates.status, score: updates.score });
    res.json({ ok: true, submission: data });
  });

  A('post', '/submissions/batch-approve', async (req, res) => {
    const score = Math.max(0, Math.min(100, Number(req.body?.defaultScore ?? 90)));
    const feedback = String(req.body?.feedback || 'Approved via Admin batch evaluation.').trim().slice(0, 500);
    const { data: pendingRows, error: fetchErr } = await db
      .from('student_assignments')
      .select('id,submission_url,status')
      .eq('status', 'submitted')
      .not('submission_url', 'is', null);
    if (fetchErr) throw fail(500, fetchErr.message);

    const eligibleIds = (pendingRows || []).filter(r => String(r.submission_url || '').trim()).map(r => r.id);
    if (!eligibleIds.length) {
      return res.json({ ok: true, approvedCount: 0, message: 'No submitted pending assignments with repository links to approve.' });
    }

    const { error: updErr } = await db
      .from('student_assignments')
      .update({ status: 'reviewed', score, feedback })
      .in('id', eligibleIds);
    if (updErr) throw fail(500, updErr.message);

    await logAudit(req, 'BATCH_APPROVE_SUBMISSIONS', 'submission', 'batch', { count: eligibleIds.length, score });
    res.json({ ok: true, approvedCount: eligibleIds.length, message: `Approved ${eligibleIds.length} submitted assignment(s).` });
  });

  // ===================================================================
  // 10. AUDIT LOGS
  // ===================================================================
  A('get', '/audit-logs', async (req, res) => {
    let dbLogs = [];
    try {
      const { data } = await db.from('admin_audit_logs').select('*').order('created_at', { ascending: false }).limit(200);
      if (Array.isArray(data)) dbLogs = data;
    } catch {}

    const seen = new Set();
    let logs = [];
    for (const row of [...sharedDevicePolicyState.blockedEvents, ...localAuditLogs, ...dbLogs]) {
      if (!row) continue;
      const key = row.id || `${row.action}|${row.target_id}|${row.created_at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      logs.push(row);
    }
    logs.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    const { action, q } = req.query || {};
    let filtered = logs;
    if (action) {
      filtered = filtered.filter(l => l.action.toLowerCase() === action.toLowerCase());
    }
    if (q) {
      const qLow = q.toLowerCase();
      filtered = filtered.filter(l =>
        l.action.toLowerCase().includes(qLow) ||
        l.target_type.toLowerCase().includes(qLow) ||
        l.admin_email.toLowerCase().includes(qLow) ||
        l.target_id?.toLowerCase().includes(qLow)
      );
    }

    res.json(filtered);
  });

  // ===================================================================
  // 11. MODULES & CURRICULUM CATALOG + STUDENT QUERIES
  // ===================================================================
  A('get', '/curriculum', async (_q, res) => {
    let courses = [];
    try {
      const { data } = await db.from('courses').select('id,title,duration,domain_type,access_url').order('title', { ascending: true });
      if (data) courses = data;
    } catch {}
    res.json({ tracks: SYLLABUS_TRACKS, courses });
  });

  A('post', '/curriculum/module', async (req, res) => {
    const b = req.body || {};
    const track = SYLLABUS_TRACKS.find(t => t.id === b.trackId) || SYLLABUS_TRACKS[0];
    if (!track) throw fail(404, 'Curriculum track not found');

    const day = Math.max(1, Math.min(30, Number(b.day || 1)));
    const title = String(b.title || '').trim();
    const hours = Math.max(0.5, Math.min(12, Number(b.hours ?? 3)));
    const topics = Array.isArray(b.topics)
      ? b.topics.map(x => String(x || '').trim()).filter(Boolean)
      : String(b.topics || '').split(',').map(x => x.trim()).filter(Boolean);
    if (!title) throw fail(400, 'Module title is required');

    const status = ['completed', 'active', 'scheduled'].includes(b.status) ? b.status : undefined;
    const modIndex = Number.isInteger(Number(b.index)) && Number(b.index) >= 0 ? Number(b.index) : -1;

    if (modIndex >= 0 && track.modules[modIndex]) {
      track.modules[modIndex] = {
        ...track.modules[modIndex],
        day,
        hours,
        title,
        topics: topics.length ? topics : track.modules[modIndex].topics,
        ...(status ? { status } : {})
      };
    } else {
      track.modules.push({
        day,
        hours,
        title,
        topics: topics.length ? topics : ['Guided Lab Exercise', 'Deliverable Checkpoint'],
        ...(status ? { status } : {})
      });
      track.modules.sort((x, y) => Number(x.day) - Number(y.day));
    }

    const totalHours = track.modules.reduce((sum, m) => sum + Number(m.hours || 3), 0);
    track.duration = `${totalHours} Hours (${track.modules.length} Modules)`;

    await logAudit(req, 'UPDATE_CURRICULUM', 'track', track.id, { day, title, hours });
    res.json({ ok: true, track });
  });

  A('get', '/queries', async (_q, res) => {
    res.json(sharedSupportTickets.slice().reverse());
  });

  A('post', '/queries/:id/resolve', async (req, res) => {
    const ticket = sharedSupportTickets.find(t => t.id === req.params.id);
    if (!ticket) throw fail(404, 'Support query not found');
    const { status, reply, assignedMentorId, assignedMentorName } = req.body || {};
    ticket.status = status === 'Open' ? 'Open' : 'Resolved';
    if (reply !== undefined) ticket.adminReply = String(reply || '').trim().slice(0, 1000) || null;
    if (assignedMentorId !== undefined) ticket.assignedMentorId = assignedMentorId || null;
    if (assignedMentorName !== undefined) ticket.assignedMentorName = assignedMentorName ? String(assignedMentorName).trim().slice(0, 120) : null;
    ticket.resolvedAt = ticket.status === 'Resolved' ? new Date().toISOString() : null;
    await logAudit(req, 'RESOLVE_QUERY', 'ticket', ticket.id, { status: ticket.status, assignedMentorId: ticket.assignedMentorId });
    res.json({ ok: true, ticket });
  });

  A('post', '/queries/auto-assign', async (req, res) => {
    let mentors = [];
    try {
      const { data } = await db.from('mentors').select('id,name,domain').eq('active', true);
      if (data?.length) mentors = data;
    } catch {}
    if (!mentors.length) mentors = localMentors.filter(m => m.active !== false);

    const pending = sharedSupportTickets.filter(t => t.status !== 'Resolved' && !t.assignedMentorId);
    if (!pending.length || !mentors.length) {
      return res.json({ ok: true, assignedCount: 0, message: 'No unassigned open queries in queue.' });
    }

    pending.forEach((ticket, idx) => {
      const m = mentors[idx % mentors.length];
      ticket.assignedMentorId = m.id;
      ticket.assignedMentorName = m.name;
    });
    await logAudit(req, 'AUTO_ASSIGN_QUERIES', 'ticket', 'batch', { assignedCount: pending.length });
    res.json({ ok: true, assignedCount: pending.length, message: `Assigned ${pending.length} open query ticket(s) across ${mentors.length} mentor(s).` });
  });
}
